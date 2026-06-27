// Ad accounting + serving: CPM spend tracks impressions exactly and the campaign
// auto-pauses at budget; feed injection places one ad per 5 organic videos.
process.env.NODE_ENV = 'test';
process.env.MOMO_PROVIDER = 'simulator';
process.env.DATA_DIR ||= new URL('./tmpdata-ads', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });

const { db } = await import('../server/db.js');
const { injectAds, recordAdEvent } = await import('../server/ads.js');

const userId = db.prepare("INSERT INTO users (name, handle, phone) VALUES ('Adv','adv','250788000111')").run().lastInsertRowid;
const advId = db.prepare("INSERT INTO advertisers (user_id, company_name) VALUES (?, 'Brand')").run(userId).lastInsertRowid;
// CPM 3000 RWF, budget 30 RWF => exactly 10 paid impressions.
const campId = db.prepare("INSERT INTO ad_campaigns (advertiser_id, name, status, cpm_rate_rwf, budget_rwf) VALUES (?, 'C', 'active', 3000, 30)").run(advId).lastInsertRowid;
const adId = db.prepare("INSERT INTO ads (campaign_id, kind, filename, renditions, status) VALUES (?, 'video', 'ad1', '[\"480\"]', 'ready')").run(campId).lastInsertRowid;

test('impressions burn budget at CPM and the campaign pauses at the cap', () => {
  for (let i = 0; i < 9; i++) recordAdEvent(db, adId, 'impression', null);
  let c = db.prepare('SELECT * FROM ad_campaigns WHERE id=?').get(campId);
  assert.equal(c.spent_rwf, 27, '9 impressions x 3 RWF');
  assert.equal(c.status, 'active', 'still active under budget');

  recordAdEvent(db, adId, 'impression', null); // 10th -> hits 30 RWF budget
  c = db.prepare('SELECT * FROM ad_campaigns WHERE id=?').get(campId);
  assert.equal(c.spent_rwf, 30, 'spend equals budget');
  assert.equal(c.status, 'paused', 'auto-paused at budget');
});

test('clicks are recorded but never charged', () => {
  const before = db.prepare('SELECT spent_rwf FROM ad_campaigns WHERE id=?').get(campId).spent_rwf;
  recordAdEvent(db, adId, 'click', null);
  const after = db.prepare('SELECT spent_rwf FROM ad_campaigns WHERE id=?').get(campId).spent_rwf;
  assert.equal(after, before, 'click did not change spend');
  const clicks = db.prepare("SELECT COUNT(*) n FROM ad_events WHERE campaign_id=? AND type='click'").get(campId).n;
  assert.equal(clicks, 1);
});

test('paused campaigns are not injected; active ones appear once per 5 videos', () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, title: 'v' }));
  // campaign is paused now -> no ads
  assert.equal(injectAds(db, rows).filter((r) => r.is_ad).length, 0, 'paused -> no injection');

  // reactivate with fresh budget
  db.prepare("UPDATE ad_campaigns SET status='active', budget_rwf=100000 WHERE id=?").run(campId);
  const out = injectAds(db, rows);
  const ads = out.filter((r) => r.is_ad);
  assert.equal(ads.length, 2, 'two ad slots for 10 videos');
  assert.equal(out.length, 12, 'rows + ads');
  assert.ok(ads[0].is_ad && ads[0].cta_url !== undefined, 'ad slide shape');
});
