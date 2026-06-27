// Ads platform: advertiser campaigns, in-feed ad serving, and CPM accounting.
//
// Pricing is CPM (cost per 1,000 impressions), the Instagram/Meta model, in RWF.
// Advertisers submit campaigns + creative; an admin approves and (for now) bills
// offline, then activates. Active campaigns are injected into the feed and each
// impression burns budget at the campaign's CPM until the budget runs out.
import path from 'node:path';
import fs from 'node:fs';

export const DEFAULT_CPM_RWF = 3000; // standard rate card: RWF 3,000 per 1,000 views
const AD_EVERY = 5;                  // one sponsored slide per 5 organic videos

const parseRen = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };

// Active, in-budget, in-window campaigns → ad rows to inject.
function pickAds(db, count) {
  const now = Math.floor(Date.now() / 1000);
  return db.prepare(`
    SELECT a.*, c.id AS campaign_id, c.name AS campaign_name, c.cpm_rate_rwf, c.budget_rwf, c.spent_rwf
    FROM ads a JOIN ad_campaigns c ON c.id = a.campaign_id
    WHERE a.status='ready' AND c.status='active' AND c.spent_rwf < c.budget_rwf
      AND (c.starts_at IS NULL OR c.starts_at <= ?)
      AND (c.ends_at   IS NULL OR c.ends_at   >= ?)
    ORDER BY RANDOM() LIMIT ?
  `).all(now, now, count);
}

function adSlide(a) {
  return {
    is_ad: true,
    ad_id: a.id,
    id: `ad-${a.id}`,
    filename: a.filename,
    renditions: a.renditions,
    kind: 'watch',
    title: a.caption || a.headline || '',
    headline: a.headline || a.campaign_name || 'Sponsored',
    cta_label: a.cta_label || 'Learn more',
    cta_url: a.cta_url || '',
    creator_name: a.headline || a.campaign_name || 'Sponsored',
    creator_handle: 'sponsored',
    creator_color: '#1f2533',
    sound: 'Sponsored',
    likes: 0, tip_count: 0, repost_count: 0, save_count: 0,
  };
}

// Inject one ad every AD_EVERY rows into an already-ordered feed array.
export function injectAds(db, rows) {
  if (!rows.length) return rows;
  const slots = Math.floor(rows.length / AD_EVERY);
  if (slots < 1) return rows;
  const ads = pickAds(db, slots);
  if (!ads.length) return rows;
  const out = [];
  let placed = 0;
  for (let i = 0; i < rows.length; i++) {
    out.push(rows[i]);
    if ((i + 1) % AD_EVERY === 0) { out.push(adSlide(ads[placed % ads.length])); placed++; }
  }
  return out;
}

// Record an impression or click. Impressions are billed: spend is recomputed
// exactly from the impression count so it never drifts, and the campaign auto-
// pauses once it has delivered the impressions its budget pays for.
export function recordAdEvent(db, adId, type, userId) {
  const ad = db.prepare('SELECT id, campaign_id FROM ads WHERE id=?').get(Number(adId));
  if (!ad) return { ok: false };
  const ev = type === 'click' ? 'click' : 'impression';
  db.prepare('INSERT INTO ad_events (ad_id, campaign_id, type, user_id) VALUES (?,?,?,?)')
    .run(ad.id, ad.campaign_id, ev, userId || null);
  if (ev === 'impression') {
    const c = db.prepare('SELECT cpm_rate_rwf, budget_rwf, status FROM ad_campaigns WHERE id=?').get(ad.campaign_id);
    if (c) {
      const impr = db.prepare("SELECT COUNT(*) n FROM ad_events WHERE campaign_id=? AND type='impression'").get(ad.campaign_id).n;
      const spent = Math.floor((impr * c.cpm_rate_rwf) / 1000);
      const maxImpr = Math.floor((c.budget_rwf * 1000) / c.cpm_rate_rwf);
      const status = impr >= maxImpr && c.status === 'active' ? 'paused' : c.status;
      db.prepare('UPDATE ad_campaigns SET spent_rwf=?, status=? WHERE id=?').run(spent, status, ad.campaign_id);
    }
  }
  return { ok: true };
}

function campaignReport(db, c) {
  const impr = db.prepare("SELECT COUNT(*) n FROM ad_events WHERE campaign_id=? AND type='impression'").get(c.id).n;
  const clicks = db.prepare("SELECT COUNT(*) n FROM ad_events WHERE campaign_id=? AND type='click'").get(c.id).n;
  const ad = db.prepare('SELECT * FROM ads WHERE campaign_id=? ORDER BY id DESC LIMIT 1').get(c.id);
  return {
    ...c,
    impressions: impr,
    clicks,
    ctr: impr ? Math.round((clicks / impr) * 1000) / 10 : 0, // %
    amount_due_rwf: Math.floor((impr * c.cpm_rate_rwf) / 1000),
    ad: ad ? { id: ad.id, kind: ad.kind, filename: ad.filename, renditions: ad.renditions, status: ad.status, headline: ad.headline, caption: ad.caption, cta_label: ad.cta_label, cta_url: ad.cta_url } : null,
  };
}

// Registers all ad routes. `deps` carries the shared helpers from index.js so
// this module stays decoupled from the HTTP/auth plumbing.
export function registerAds(app, deps) {
  const { db, sendJson, requireUser, currentUser, requireAdmin, parseUpload, renderRenditions, probeDuration, putObject, storageMode, videosDir, config } = deps;

  function advertiserFor(user, companyName) {
    let adv = db.prepare('SELECT * FROM advertisers WHERE user_id=?').get(user.id);
    if (!adv) {
      const info = db.prepare('INSERT INTO advertisers (user_id, company_name, contact_name, phone) VALUES (?,?,?,?)')
        .run(user.id, companyName || user.name, user.name, user.phone || '');
      adv = db.prepare('SELECT * FROM advertisers WHERE id=?').get(Number(info.lastInsertRowid));
    } else if (companyName && companyName !== adv.company_name) {
      db.prepare('UPDATE advertisers SET company_name=? WHERE id=?').run(companyName, adv.id);
      adv.company_name = companyName;
    }
    return adv;
  }

  function ownCampaign(req) {
    const user = requireUser(req);
    const c = db.prepare('SELECT * FROM ad_campaigns WHERE id=?').get(Number(req.params.id));
    if (!c) throw Object.assign(new Error('Campaign not found'), { status: 404 });
    const adv = db.prepare('SELECT * FROM advertisers WHERE id=?').get(c.advertiser_id);
    if (!adv || Number(adv.user_id) !== Number(user.id)) throw Object.assign(new Error('Not your campaign'), { status: 403 });
    return c;
  }

  // Rate card.
  app.get('/api/ads/ratecard', (req, res) => {
    sendJson(res, 200, { cpm_rate_rwf: DEFAULT_CPM_RWF, currency: 'RWF', note: 'Price per 1,000 views (CPM), like Instagram, in Rwandan francs.' });
  });

  // Create a campaign (advertiser = the logged-in user).
  app.post('/api/ads/campaigns', (req, res) => {
    const user = requireUser(req);
    const b = req.body ?? {};
    const budget = Math.max(0, Math.floor(Number(b.budget_rwf) || 0));
    if (!b.name || !budget) return sendJson(res, 400, { error: 'Name and budget are required' });
    const cpm = Math.max(100, Math.floor(Number(b.cpm_rate_rwf) || DEFAULT_CPM_RWF));
    const adv = advertiserFor(user, b.company_name);
    const info = db.prepare(`INSERT INTO ad_campaigns (advertiser_id, name, status, cpm_rate_rwf, budget_rwf, starts_at, ends_at)
      VALUES (?,?, 'pending_review', ?,?,?,?)`).run(
      adv.id, String(b.name).slice(0, 120), cpm, budget,
      b.starts_at ? Math.floor(Number(b.starts_at)) : null,
      b.ends_at ? Math.floor(Number(b.ends_at)) : null);
    sendJson(res, 200, db.prepare('SELECT * FROM ad_campaigns WHERE id=?').get(Number(info.lastInsertRowid)));
  });

  // Upload the ad creative (image or video) for a campaign.
  app.post('/api/ads/campaigns/:id/creative', async (req, res) => {
    const c = ownCampaign(req);
    const tmp = path.join(config.dataDir, 'tmp');
    const { fields, files } = await parseUpload(req, tmp);
    const cleanup = [];
    const media = files.find((f) => f.field === 'video' || f.field === 'image' || f.field === 'media');
    if (!media) { for (const f of files) fs.rm(f.path, { force: true }, () => {}); return sendJson(res, 400, { error: 'No image or video' }); }
    cleanup.push(media.path);
    const isImage = media.field === 'image' || /\.(jpe?g|png|webp|gif|heic|bmp)$/i.test(media.filename || '');
    const stem = `ad${Date.now()}`;
    const outBase = path.join(videosDir, stem);
    const info = db.prepare(`INSERT INTO ads (campaign_id, kind, filename, status, headline, caption, cta_label, cta_url)
      VALUES (?,?,?, 'processing', ?,?,?,?)`).run(
      c.id, isImage ? 'image' : 'video', stem,
      String(fields.headline || '').slice(0, 80), String(fields.caption || '').slice(0, 200),
      String(fields.cta_label || 'Learn more').slice(0, 24), String(fields.cta_url || '').slice(0, 300));
    const adId = Number(info.lastInsertRowid);
    sendJson(res, 200, db.prepare('SELECT * FROM ads WHERE id=?').get(adId));

    (async () => {
      try {
        const labels = await renderRenditions(media.path, outBase, {
          isImage,
          onFirst: async () => {
            const p480 = `${outBase}_480.mp4`;
            if (storageMode === 'r2') { await putObject(`videos/${stem}_480.mp4`, fs.readFileSync(p480), 'video/mp4'); fs.rmSync(p480, { force: true }); }
            db.prepare("UPDATE ads SET status='ready', renditions=? WHERE id=?").run(JSON.stringify(['480']), adId);
          },
        });
        if (storageMode === 'r2') {
          for (const label of labels) {
            if (label === '480') continue;
            const p = `${outBase}_${label}.mp4`;
            if (fs.existsSync(p)) { await putObject(`videos/${stem}_${label}.mp4`, fs.readFileSync(p), 'video/mp4'); fs.rmSync(p, { force: true }); }
          }
        }
        db.prepare("UPDATE ads SET renditions=? WHERE id=?").run(JSON.stringify(labels), adId);
      } catch (e) {
        console.error(`[ad] creative ${adId} failed:`, e?.message || e);
        try { db.prepare("UPDATE ads SET status='failed' WHERE id=?").run(adId); } catch {}
      } finally {
        for (const f of cleanup) fs.rm(f, { force: true }, () => {});
      }
    })();
  });

  // My campaigns (with live stats).
  app.get('/api/ads/campaigns', (req, res) => {
    const user = requireUser(req);
    const adv = db.prepare('SELECT * FROM advertisers WHERE user_id=?').get(user.id);
    if (!adv) return sendJson(res, 200, { advertiser: null, campaigns: [] });
    const rows = db.prepare('SELECT * FROM ad_campaigns WHERE advertiser_id=? ORDER BY id DESC').all(adv.id);
    sendJson(res, 200, { advertiser: adv, campaigns: rows.map((c) => campaignReport(db, c)) });
  });

  app.get('/api/ads/campaigns/:id', (req, res) => {
    const c = ownCampaign(req);
    sendJson(res, 200, campaignReport(db, c));
  });

  // Impression / click beacons (open; viewer optional).
  app.post('/api/ads/:id/impression', (req, res) => {
    const u = currentUser(req);
    sendJson(res, 200, recordAdEvent(db, req.params.id, 'impression', u?.id));
  });
  app.post('/api/ads/:id/click', (req, res) => {
    const u = currentUser(req);
    sendJson(res, 200, recordAdEvent(db, req.params.id, 'click', u?.id));
  });

  // ---- Admin ----
  app.get('/api/admin/ads/campaigns', (req, res) => {
    requireAdmin(req);
    const rows = db.prepare(`SELECT c.*, adv.company_name FROM ad_campaigns c JOIN advertisers adv ON adv.id=c.advertiser_id ORDER BY c.id DESC`).all();
    sendJson(res, 200, rows.map((c) => campaignReport(db, c)));
  });

  // Approve / reject / pause / activate, and mark paid. Body: { status?, paid? }.
  app.post('/api/admin/ads/campaigns/:id', (req, res) => {
    requireAdmin(req);
    const c = db.prepare('SELECT * FROM ad_campaigns WHERE id=?').get(Number(req.params.id));
    if (!c) return sendJson(res, 404, { error: 'Not found' });
    const b = req.body ?? {};
    const allowed = ['approved', 'active', 'paused', 'rejected', 'ended'];
    const status = allowed.includes(b.status) ? b.status : c.status;
    const paid = b.paid === undefined ? c.paid : (b.paid ? 1 : 0);
    db.prepare('UPDATE ad_campaigns SET status=?, paid=? WHERE id=?').run(status, paid, c.id);
    sendJson(res, 200, campaignReport(db, db.prepare('SELECT * FROM ad_campaigns WHERE id=?').get(c.id)));
  });
}
