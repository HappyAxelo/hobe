import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { createApp, sendJson } from './http.js';
import { parseUpload } from './multipart.js';
import { config } from './config.js';
import { db, getBalance } from './db.js';
import {
  provider, startTip, startOrder, startWithdrawal, availableBalance,
  confirmDelivery, refundOrder, startSettlementWorker,
} from './money.js';
import { renderRenditions, probeDuration, hasFfmpeg } from './transcode.js';
import { signup, login, getSessionUser, deleteSession, publicUser } from './auth.js';
import { storageMode, putObject, deleteObject, publicUrl, getObject } from './storage.js';
import { ensureTracks } from './tracks.js';
import { registerAds, injectAds } from './ads.js';

const app = createApp();
const videosDir = path.join(config.dataDir, 'videos');
const avatarsDir = path.join(config.dataDir, 'avatars');
const tracksDir = path.join(config.dataDir, 'tracks');

// Serve a media object from R2: redirect to the public URL when one is
// configured (so bandwidth never touches this server), otherwise proxy the
// bytes through, passing the Range header for video seeking.
async function serveFromR2(req, res, key) {
  const pub = publicUrl(key);
  if (pub) {
    res.writeHead(302, { Location: pub, 'Cache-Control': 'public, max-age=86400' });
    return res.end();
  }
  const upstream = await getObject(key, req.headers.range);
  if (upstream.status >= 400) {
    res.writeHead(upstream.status === 404 ? 404 : 502);
    return res.end();
  }
  const headers = { 'Cache-Control': 'public, max-age=86400' };
  for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag']) {
    const v = upstream.headers.get(h);
    if (v) headers[h] = v;
  }
  res.writeHead(upstream.status, headers);
  const { Readable } = await import('node:stream');
  Readable.fromWeb(upstream.body).pipe(res);
}

// Get a local filesystem path for a library track (downloading from R2 first
// when needed) so ffmpeg can read it. Returns null if the track is missing.
async function localTrackPath(filename, tmp) {
  if (storageMode !== 'r2') {
    const local = path.join(tracksDir, filename);
    return fs.existsSync(local) ? local : null;
  }
  const r = await getObject(`tracks/${filename}`);
  if (r.status >= 400) return null;
  const dest = path.join(tmp, `track-${Date.now()}-${filename.replace(/[^\w.-]/g, '')}`);
  const { Readable } = await import('node:stream');
  const ws = fs.createWriteStream(dest);
  await new Promise((resolve, reject) => { Readable.fromWeb(r.body).pipe(ws); ws.on('finish', resolve); ws.on('error', reject); });
  return dest;
}

// ---------- auth ----------
function currentUser(req) {
  const bearer = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
  const fromSession = getSessionUser(bearer);
  if (fromSession) return fromSession;
  if (process.env.DEMO_AUTH === '1') {
    const id = Number(req.headers['x-user-id']);
    if (id) return db.prepare('SELECT * FROM users WHERE id=?').get(id) ?? null;
  }
  return null;
}
function requireUser(req) {
  const u = currentUser(req);
  if (!u) throw Object.assign(new Error('Sign in first'), { status: 401 });
  return u;
}

// Admin = users.is_admin, or an id listed in ADMIN_USER_IDS (comma-separated).
const ADMIN_IDS = new Set(String(process.env.ADMIN_USER_IDS || '').split(',').map((x) => x.trim()).filter(Boolean));
function requireAdmin(req) {
  const u = requireUser(req);
  if (!Number(u.is_admin) && !ADMIN_IDS.has(String(u.id))) throw Object.assign(new Error('Admins only'), { status: 403 });
  return u;
}
registerAds(app, { db, sendJson, requireUser, currentUser, requireAdmin, parseUpload, renderRenditions, probeDuration, putObject, storageMode, videosDir, config });

app.post('/api/auth/signup', async (req, res) => {
  const { user, token } = signup(req.body ?? {});
  sendJson(res, 200, { token, user: { ...publicUser(user), phone: user.phone } });
});

app.post('/api/auth/login', async (req, res) => {
  const { user, token } = login(req.body ?? {});
  sendJson(res, 200, { token, user: { ...publicUser(user), phone: user.phone } });
});

app.post('/api/auth/logout', async (req, res) => {
  deleteSession(req.headers.authorization?.match(/^Bearer (.+)$/)?.[1]);
  sendJson(res, 200, { ok: true });
});

app.get('/api/me', (req, res) => {
  const u = currentUser(req);
  if (!u) return sendJson(res, 401, { error: 'Not signed in' });
  sendJson(res, 200, { ...publicUser(u), phone: u.phone, is_admin: Number(u.is_admin) || (ADMIN_IDS.has(String(u.id)) ? 1 : 0) });
});

// ---------- profile photo ----------
app.post('/api/me/avatar', async (req, res) => {
  const user = requireUser(req);
  const { file } = await parseUpload(req, path.join(config.dataDir, 'tmp'), { maxBytes: 8 * 1024 * 1024 });
  if (!file) return sendJson(res, 400, { error: 'No image file' });

  const filename = `u${user.id}-${Date.now()}.jpg`;
  const outPath = path.join(avatarsDir, filename);
  if (await hasFfmpeg()) {
    await new Promise((resolve, reject) => {
      const p = spawn('ffmpeg', ['-y', '-i', file.path,
        '-vf', 'scale=256:256:force_original_aspect_ratio=increase,crop=256:256',
        '-frames:v', '1', '-q:v', '4', outPath]);
      p.on('error', reject);
      p.on('exit', (code) => (code === 0 ? resolve() : reject(Object.assign(new Error('That file does not look like an image'), { status: 400 }))));
    });
  } else {
    fs.copyFileSync(file.path, outPath); // dev fallback without ffmpeg
  }
  fs.rmSync(file.path, { force: true });

  if (storageMode === 'r2') {
    await putObject(`avatars/${filename}`, fs.readFileSync(outPath), 'image/jpeg');
    fs.rmSync(outPath, { force: true }); // R2 holds the canonical copy now
  }

  const old = db.prepare('SELECT avatar FROM users WHERE id=?').get(user.id)?.avatar;
  db.prepare('UPDATE users SET avatar=? WHERE id=?').run(filename, user.id);
  if (old) {
    if (storageMode === 'r2') deleteObject(`avatars/${old}`).catch(() => {});
    else fs.rm(path.join(avatarsDir, String(old)), { force: true }, () => {});
  }
  sendJson(res, 200, { avatar: filename });
});

// ---------- creators (public — no phone numbers) ----------
app.get('/api/creators/:id', (req, res) => {
  const creator = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!creator) return sendJson(res, 404, { error: 'Not found' });
  const viewer = currentUser(req);
  const isOwner = viewer && Number(viewer.id) === Number(creator.id);
  // The owner sees their own still-processing (and failed) uploads; everyone
  // else only sees ready ones.
  const videos = db.prepare(
    `SELECT * FROM videos WHERE user_id=? AND deleted=0 ${isOwner ? '' : "AND status='ready'"} ORDER BY created_at DESC`
  ).all(creator.id);
  const products = db.prepare('SELECT * FROM products WHERE creator_id=? AND active=1').all(creator.id);
  const reposts = db.prepare(`
    SELECT v.*, u.name AS creator_name, u.handle AS creator_handle, u.color AS creator_color, u.avatar AS creator_avatar
    FROM reposts r JOIN videos v ON v.id = r.video_id JOIN users u ON u.id = v.user_id
    WHERE r.user_id=? AND v.deleted=0 AND v.status='ready' ORDER BY r.id DESC
  `).all(creator.id);
  const tipsTotal = Number(db.prepare(`
    SELECT COALESCE(SUM(amount),0) AS s FROM transactions WHERE type='tip' AND status='success' AND payee_user_id=?
  `).get(creator.id).s);
  const followers = Number(db.prepare('SELECT COUNT(*) c FROM follows WHERE creator_id=?').get(creator.id).c);
  const following = viewer ? !!db.prepare('SELECT 1 FROM follows WHERE follower_id=? AND creator_id=?').get(viewer.id, creator.id) : false;
  sendJson(res, 200, { ...publicUser(creator), videos, products, reposts, tips_total: tipsTotal, followers, following });
});

// ---------- feed ----------
app.get('/api/feed', (req, res) => {
  const kind = req.query.kind === 'learn' ? 'learn' : 'watch';
  const rows = db.prepare(`
    SELECT v.*, u.name AS creator_name, u.handle AS creator_handle, u.color AS creator_color, u.avatar AS creator_avatar,
      (SELECT COUNT(*) FROM transactions t WHERE t.video_id=v.id AND t.type='tip' AND t.status='success') AS tip_count,
      (SELECT COUNT(*) FROM reposts r WHERE r.video_id=v.id) AS repost_count,
      (SELECT COUNT(*) FROM saves sv WHERE sv.video_id=v.id) AS save_count,
      u.verified AS creator_verified
    FROM videos v JOIN users u ON u.id = v.user_id
    WHERE v.kind = ? AND v.deleted = 0 AND v.status = 'ready'
    ORDER BY v.created_at DESC LIMIT 200
  `).all(kind);
  const fuser = currentUser(req);
  if (fuser) {
    const rep = new Set(db.prepare('SELECT video_id FROM reposts WHERE user_id=?').all(fuser.id).map((x) => x.video_id));
    const sav = new Set(db.prepare('SELECT video_id FROM saves WHERE user_id=?').all(fuser.id).map((x) => x.video_id));
    const lik = new Set(db.prepare('SELECT video_id FROM video_likes WHERE user_id=?').all(fuser.id).map((x) => x.video_id));
    const fol = new Set(db.prepare('SELECT creator_id FROM follows WHERE follower_id=?').all(fuser.id).map((x) => x.creator_id));
    for (const r of rows) { r.reposted = rep.has(r.id); r.saved = sav.has(r.id); r.liked = lik.has(r.id); r.following = fol.has(r.user_id); }
  }
  const now = Date.now() / 1000;
  for (const r of rows) {
    const ageHours = Math.max((now - Number(r.created_at)) / 3600, 0.1);
    r.score = (1 + Number(r.views) + Number(r.likes) * 3 + Number(r.tip_count) * 12) / Math.pow(ageHours + 2, 1.4);
  }
  rows.sort((a, b) => b.score - a.score);
  sendJson(res, 200, injectAds(db, rows.slice(0, 50)));
});

// ---------- search ----------
// Matches video captions/#tags (stored in title) and creator name/handle.
app.get('/api/search', (req, res) => {
  const term = String(req.query.q || '').replace(/[%_\\]/g, ' ').trim();
  if (!term) return sendJson(res, 200, { creators: [], videos: [] });
  const like = `%${term}%`;

  const creators = db.prepare(`
    SELECT id, name, handle, color, avatar, verified,
      (SELECT COUNT(*) FROM follows f WHERE f.creator_id = users.id) AS followers
    FROM users
    WHERE name LIKE ? OR handle LIKE ?
    ORDER BY followers DESC, name LIMIT 20
  `).all(like, like);

  const videos = db.prepare(`
    SELECT v.*, u.name AS creator_name, u.handle AS creator_handle, u.color AS creator_color, u.avatar AS creator_avatar,
      (SELECT COUNT(*) FROM transactions t WHERE t.video_id=v.id AND t.type='tip' AND t.status='success') AS tip_count,
      (SELECT COUNT(*) FROM reposts r WHERE r.video_id=v.id) AS repost_count,
      (SELECT COUNT(*) FROM saves sv WHERE sv.video_id=v.id) AS save_count,
      u.verified AS creator_verified
    FROM videos v JOIN users u ON u.id = v.user_id
    WHERE v.deleted=0 AND v.status='ready'
      AND (v.title LIKE ? OR u.handle LIKE ? OR u.name LIKE ?)
    ORDER BY v.created_at DESC LIMIT 40
  `).all(like, like, like);

  const fuser = currentUser(req);
  if (fuser) {
    const rep = new Set(db.prepare('SELECT video_id FROM reposts WHERE user_id=?').all(fuser.id).map((x) => x.video_id));
    const sav = new Set(db.prepare('SELECT video_id FROM saves WHERE user_id=?').all(fuser.id).map((x) => x.video_id));
    const lik = new Set(db.prepare('SELECT video_id FROM video_likes WHERE user_id=?').all(fuser.id).map((x) => x.video_id));
    const fol = new Set(db.prepare('SELECT creator_id FROM follows WHERE follower_id=?').all(fuser.id).map((x) => x.creator_id));
    for (const r of videos) { r.reposted = rep.has(r.id); r.saved = sav.has(r.id); r.liked = lik.has(r.id); r.following = fol.has(r.user_id); }
    for (const c of creators) c.following = fol.has(c.id);
  }
  sendJson(res, 200, { creators, videos });
});

app.post('/api/videos/:id/view', (req, res) => {
  db.prepare('UPDATE videos SET views = views + 1 WHERE id=?').run(req.params.id);
  sendJson(res, 200, { ok: true });
});
app.post('/api/videos/:id/like', (req, res) => {
  const user = requireUser(req);
  const vid = Number(req.params.id);
  const exists = db.prepare('SELECT 1 FROM video_likes WHERE user_id=? AND video_id=?').get(user.id, vid);
  if (exists) {
    db.prepare('DELETE FROM video_likes WHERE user_id=? AND video_id=?').run(user.id, vid);
    db.prepare('UPDATE videos SET likes = MAX(0, likes - 1) WHERE id=?').run(vid);
  } else {
    db.prepare('INSERT INTO video_likes (user_id, video_id) VALUES (?, ?)').run(user.id, vid);
    db.prepare('UPDATE videos SET likes = likes + 1 WHERE id=?').run(vid);
  }
  const likes = Number(db.prepare('SELECT likes FROM videos WHERE id=?').get(vid)?.likes ?? 0);
  sendJson(res, 200, { liked: !exists, likes });
});

// ---------- repost / save (toggle) ----------
app.post('/api/videos/:id/repost', (req, res) => {
  const user = requireUser(req);
  const vid = Number(req.params.id);
  const exists = db.prepare('SELECT 1 FROM reposts WHERE user_id=? AND video_id=?').get(user.id, vid);
  if (exists) db.prepare('DELETE FROM reposts WHERE user_id=? AND video_id=?').run(user.id, vid);
  else db.prepare('INSERT INTO reposts (user_id, video_id) VALUES (?, ?)').run(user.id, vid);
  const count = Number(db.prepare('SELECT COUNT(*) c FROM reposts WHERE video_id=?').get(vid).c);
  sendJson(res, 200, { reposted: !exists, count });
});

app.post('/api/videos/:id/save', (req, res) => {
  const user = requireUser(req);
  const vid = Number(req.params.id);
  const exists = db.prepare('SELECT 1 FROM saves WHERE user_id=? AND video_id=?').get(user.id, vid);
  if (exists) db.prepare('DELETE FROM saves WHERE user_id=? AND video_id=?').run(user.id, vid);
  else db.prepare('INSERT INTO saves (user_id, video_id) VALUES (?, ?)').run(user.id, vid);
  const count = Number(db.prepare('SELECT COUNT(*) c FROM saves WHERE video_id=?').get(vid).c);
  sendJson(res, 200, { saved: !exists, count });
});

app.get('/api/saved', (req, res) => {
  const user = requireUser(req);
  const rows = db.prepare(`
    SELECT v.*, u.name AS creator_name, u.handle AS creator_handle, u.color AS creator_color, u.avatar AS creator_avatar,
      (SELECT COUNT(*) FROM transactions t WHERE t.video_id=v.id AND t.type='tip' AND t.status='success') AS tip_count,
      (SELECT COUNT(*) FROM reposts r WHERE r.video_id=v.id) AS repost_count
    FROM saves s JOIN videos v ON v.id = s.video_id JOIN users u ON u.id = v.user_id
    WHERE s.user_id=? AND v.deleted=0 AND v.status='ready' ORDER BY s.id DESC
  `).all(user.id);
  for (const r of rows) r.saved = true;
  sendJson(res, 200, rows);
});

// ---------- follow (toggle) ----------
app.post('/api/creators/:id/follow', (req, res) => {
  const user = requireUser(req);
  const cid = Number(req.params.id);
  if (cid === user.id) return sendJson(res, 400, { error: "You can't follow yourself" });
  const exists = db.prepare('SELECT 1 FROM follows WHERE follower_id=? AND creator_id=?').get(user.id, cid);
  if (exists) db.prepare('DELETE FROM follows WHERE follower_id=? AND creator_id=?').run(user.id, cid);
  else db.prepare('INSERT INTO follows (follower_id, creator_id) VALUES (?, ?)').run(user.id, cid);
  const followers = Number(db.prepare('SELECT COUNT(*) c FROM follows WHERE creator_id=?').get(cid).c);
  sendJson(res, 200, { following: !exists, followers });
});

// ---------- music library ----------
app.get('/api/tracks', (req, res) => {
  sendJson(res, 200, db.prepare('SELECT id, title, artist, filename, duration_s FROM tracks ORDER BY id').all());
});

// ---------- upload / edit / delete (owner only) ----------
app.post('/api/videos', async (req, res) => {
  const user = requireUser(req);
  const tmp = path.join(config.dataDir, 'tmp');
  const { fields, files } = await parseUpload(req, tmp);
  const cleanup = []; // temp inputs to remove once the background job is done

  const mediaFile = files.find((f) => f.field === 'video' || f.field === 'image' || f.field === 'media');
  if (!mediaFile) {
    for (const f of files) fs.rm(f.path, { force: true }, () => {});
    return sendJson(res, 400, { error: 'No video or image file' });
  }
  cleanup.push(mediaFile.path);
  const isImage = mediaFile.field === 'image' || /\.(jpe?g|png|webp|gif|heic|bmp)$/i.test(mediaFile.filename || '');

  // Soundtrack: an uploaded audio file, or a chosen library track.
  let audioPath = null;
  let sound = 'Original sound';
  const audioFile = files.find((f) => f.field === 'audio');
  if (audioFile) { audioPath = audioFile.path; cleanup.push(audioPath); sound = 'Original audio'; }
  else if (fields.track_id) {
    const track = db.prepare('SELECT * FROM tracks WHERE id=?').get(Number(fields.track_id));
    if (track) {
      sound = track.artist ? `${track.title} · ${track.artist}` : track.title;
      const tp = await localTrackPath(track.filename, tmp);
      if (tp) { audioPath = tp; if (tp.startsWith(tmp)) cleanup.push(tp); } // shared assets aren't in tmp — don't delete them
    }
  }

  const stem = `v${Date.now()}`;
  const outBase = path.join(videosDir, stem);

  // Save the row as 'processing' and reply straight away. The heavy ffmpeg
  // encode + upload runs in the background, so posting feels instant; the feed
  // only shows videos once they flip to 'ready'.
  const info = db.prepare(`
    INSERT INTO videos (user_id, title, kind, lang, filename, sound, status)
    VALUES (?, ?, ?, ?, ?, ?, 'processing')
  `).run(user.id, fields.title || 'Untitled', fields.kind === 'learn' ? 'learn' : 'watch', fields.lang || 'rw', stem, sound);
  const videoId = Number(info.lastInsertRowid);
  sendJson(res, 200, db.prepare('SELECT * FROM videos WHERE id=?').get(videoId));

  processUpload({ videoId, isImage, mediaPath: mediaFile.path, audioPath, outBase, stem, cleanup })
    .catch((e) => {
      console.error(`[upload] video ${videoId} transcode failed:`, e?.message || e);
      try { db.prepare("UPDATE videos SET status='failed' WHERE id=?").run(videoId); } catch { /* db gone */ }
      for (const f of cleanup) fs.rm(f, { force: true }, () => {});
    });
});

// Background worker: encode, store, then mark the video ready. ffmpeg runs as a
// child process so this never blocks the event loop or other requests.
async function processUpload({ videoId, isImage, mediaPath, audioPath, outBase, stem, cleanup }) {
  try {
    const labels = await renderRenditions(mediaPath, outBase, {
      isImage, audioPath,
      onFirst: async () => {
        // Publish as soon as the 480p floor exists, so the post goes live fast.
        const p480 = `${outBase}_480.mp4`;
        const duration = await probeDuration(p480);
        const size = fs.statSync(p480).size;
        if (storageMode === 'r2') { await putObject(`videos/${stem}_480.mp4`, fs.readFileSync(p480), 'video/mp4'); fs.rmSync(p480, { force: true }); }
        db.prepare("UPDATE videos SET status='ready', duration_s=?, size_bytes=?, renditions=? WHERE id=?")
          .run(duration, size, JSON.stringify(['480']), videoId);
      },
    });
    // Upload the HD renditions made after the floor, then record the full set.
    if (storageMode === 'r2') {
      for (const label of labels) {
        if (label === '480') continue;
        const p = `${outBase}_${label}.mp4`;
        if (fs.existsSync(p)) { await putObject(`videos/${stem}_${label}.mp4`, fs.readFileSync(p), 'video/mp4'); fs.rmSync(p, { force: true }); }
      }
    }
    db.prepare("UPDATE videos SET renditions=? WHERE id=?").run(JSON.stringify(labels), videoId);
  } finally {
    for (const f of cleanup) fs.rm(f, { force: true }, () => {});
  }
}

// Single video — used by the client to poll until a fresh upload is ready.
app.get('/api/videos/:id', (req, res) => {
  const v = db.prepare('SELECT id, user_id, title, kind, lang, filename, duration_s, status, renditions, created_at FROM videos WHERE id=? AND deleted=0').get(Number(req.params.id));
  if (!v) return sendJson(res, 404, { error: 'Not found' });
  sendJson(res, 200, v);
});

function ownVideo(req) {
  const user = requireUser(req);
  const video = db.prepare('SELECT * FROM videos WHERE id=? AND deleted=0').get(Number(req.params.id));
  if (!video) throw Object.assign(new Error('Video not found'), { status: 404 });
  if (Number(video.user_id) !== Number(user.id)) throw Object.assign(new Error('You can only manage your own videos'), { status: 403 });
  return video;
}

app.post('/api/videos/:id/edit', async (req, res) => {
  const video = ownVideo(req);
  const { title, lang, kind } = req.body ?? {};
  const newTitle = String(title ?? video.title).trim().slice(0, 120) || video.title;
  const newLang = ['rw', 'en', 'fr', 'sw'].includes(lang) ? lang : video.lang;
  const newKind = ['watch', 'learn'].includes(kind) ? kind : video.kind;
  db.prepare('UPDATE videos SET title=?, lang=?, kind=? WHERE id=?').run(newTitle, newLang, newKind, video.id);
  sendJson(res, 200, db.prepare('SELECT * FROM videos WHERE id=?').get(video.id));
});

app.post('/api/videos/:id/delete', async (req, res) => {
  const video = ownVideo(req);
  // Soft delete: the row stays (tips reference it in the ledger), the file goes.
  db.prepare('UPDATE videos SET deleted=1 WHERE id=?').run(video.id);
  let rens = null; try { rens = video.renditions ? JSON.parse(video.renditions) : null; } catch { rens = null; }
  const keys = rens && rens.length ? rens.map((r) => `videos/${video.filename}_${r}.mp4`) : [`videos/${video.filename}`];
  for (const k of keys) {
    if (storageMode === 'r2') deleteObject(k).catch(() => {});
    else fs.rm(path.join(config.dataDir, k), { force: true }, () => {});
  }
  sendJson(res, 200, { ok: true });
});

// ---------- money: tips ----------
app.post('/api/tips', async (req, res) => {
  const user = currentUser(req);
  const { video_id, amount, payer_phone } = req.body ?? {};
  const phone = payer_phone || user?.phone;
  if (!phone) return sendJson(res, 400, { error: 'payer_phone required' });
  const txn = await startTip({ videoId: video_id, amount: Number(amount), payerPhone: phone });
  sendJson(res, 202, txn);
});

app.get('/api/transactions/:id', (req, res) => {
  const txn = db.prepare('SELECT * FROM transactions WHERE id=?').get(req.params.id);
  if (!txn) return sendJson(res, 404, { error: 'Not found' });
  sendJson(res, 200, txn);
});

// ---------- money: wallet & withdrawals ----------
app.get('/api/wallet', (req, res) => {
  const user = requireUser(req);
  const account = `user:${user.id}`;
  const entries = db.prepare(`
    SELECT l.*, t.type AS txn_type, t.status AS txn_status FROM ledger l
    JOIN transactions t ON t.id = l.txn_id
    WHERE l.account=? ORDER BY l.id DESC LIMIT 50
  `).all(account);
  const { balance, pendingOut, available } = availableBalance(user.id);
  sendJson(res, 200, {
    balance, pending_withdrawals: pendingOut, available,
    currency: config.currency, momo_number: user.phone, entries,
  });
});

app.post('/api/withdrawals', async (req, res) => {
  const user = requireUser(req);
  const txn = await startWithdrawal({ userId: user.id, amount: Number(req.body?.amount) });
  sendJson(res, 202, txn);
});

// ---------- money: storefront & escrow ----------
app.get('/api/products', (req, res) => {
  sendJson(res, 200, db.prepare(`
    SELECT p.*, u.name AS creator_name, u.handle AS creator_handle, u.color AS creator_color
    FROM products p JOIN users u ON u.id=p.creator_id WHERE p.active=1
  `).all());
});

app.post('/api/orders', async (req, res) => {
  const user = currentUser(req);
  const { product_id, payer_phone } = req.body ?? {};
  const phone = payer_phone || user?.phone;
  if (!phone) return sendJson(res, 400, { error: 'payer_phone required' });
  const order = await startOrder({ productId: product_id, payerPhone: phone, buyerUserId: user?.id ?? null });
  sendJson(res, 202, order);
});

app.get('/api/orders', (req, res) => {
  const user = requireUser(req);
  const rows = db.prepare(`
    SELECT o.*, p.title AS product_title, p.creator_id FROM orders o
    JOIN products p ON p.id = o.product_id
    WHERE o.buyer_user_id = ? OR p.creator_id = ?
    ORDER BY o.created_at DESC
  `).all(user.id, user.id);
  sendJson(res, 200, rows);
});

app.post('/api/orders/:id/confirm-delivery', async (req, res) => {
  const user = requireUser(req);
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(Number(req.params.id));
  if (!order) return sendJson(res, 404, { error: 'Not found' });
  if (order.buyer_user_id !== user.id) return sendJson(res, 403, { error: 'Only the buyer can confirm delivery' });
  sendJson(res, 200, confirmDelivery(Number(req.params.id)));
});

app.post('/api/orders/:id/refund', async (req, res) => {
  requireUser(req);
  sendJson(res, 200, refundOrder(Number(req.params.id)));
});

// ---------- content reports ----------
app.post('/api/videos/:id/report', async (req, res) => {
  const video = db.prepare('SELECT id FROM videos WHERE id=?').get(req.params.id);
  if (!video) return sendJson(res, 404, { error: 'Not found' });
  const user = currentUser(req);
  db.prepare('INSERT INTO reports (video_id, reporter_user_id, reason) VALUES (?,?,?)')
    .run(video.id, user?.id ?? null, String(req.body?.reason ?? '').slice(0, 300));
  sendJson(res, 200, { ok: true });
});

// ---------- platform stats ----------
app.get('/api/stats', (req, res) => {
  sendJson(res, 200, {
    provider: provider.name,
    platform_balance: getBalance('platform'),
    txncost_reserve: getBalance('txncost'),
    escrow_held: getBalance('escrow'),
    tips_count: Number(db.prepare("SELECT COUNT(*) c FROM transactions WHERE type='tip' AND status='success'").get().c),
  });
});

// ---------- health / durability ----------
// Lets you confirm whether posts are stored durably. durable=false means the
// host has only ephemeral disk and uploads will be lost on restart.
app.get('/api/health', (req, res) => {
  sendJson(res, 200, {
    ok: true,
    storage: storageMode,
    durable: storageMode === 'r2',
    provider: provider.name,
    videos: Number(db.prepare('SELECT COUNT(*) c FROM videos WHERE deleted=0').get().c),
    active_ad_campaigns: Number(db.prepare("SELECT COUNT(*) c FROM ad_campaigns WHERE status='active'").get().c),
  });
});

// ---------- static ----------
if (storageMode === 'r2') {
  // Media lives in R2; redirect or proxy from there.
  app.get('/videos/:file', (req, res) => serveFromR2(req, res, `videos/${req.params.file}`));
  app.get('/avatars/:file', (req, res) => serveFromR2(req, res, `avatars/${req.params.file}`));
  app.get('/tracks/:file', (req, res) => serveFromR2(req, res, `tracks/${req.params.file}`));
} else {
  app.static('/videos/', videosDir, 365 * 24 * 3600);
  app.static('/avatars/', avatarsDir, 30 * 24 * 3600);
  app.static('/tracks/', tracksDir, 365 * 24 * 3600);
}
app.static('/', path.join(config.root, 'public'), 3600);

if (process.env.NODE_ENV !== 'test') {
  if (storageMode !== 'r2') {
    console.warn('WARNING: storage is LOCAL (ephemeral). On a host with an ephemeral disk (e.g. Render free tier) uploaded videos and the database are WIPED on every restart. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET to make posts durable.');
  }
  startSettlementWorker(1000);
  ensureTracks().catch((e) => console.error('Track seeding failed:', e.message));
  app.listen(config.port, () => {
    console.log(`Hobe running on http://localhost:${config.port}  (MoMo provider: ${provider.name}, storage: ${storageMode})`);
  });
}

export { app };
