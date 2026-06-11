import path from 'node:path';
import fs from 'node:fs';
import { createApp, sendJson } from './http.js';
import { parseUpload } from './multipart.js';
import { config } from './config.js';
import { db, getBalance } from './db.js';
import {
  provider, startTip, startOrder, startWithdrawal, availableBalance,
  confirmDelivery, refundOrder, startSettlementWorker,
} from './money.js';
import { transcode, probeDuration } from './transcode.js';
import { signup, login, getSessionUser, deleteSession, publicUser } from './auth.js';

const app = createApp();
const videosDir = path.join(config.dataDir, 'videos');

// ---------- auth ----------
// Session token in Authorization: Bearer <token>.
// DEMO_AUTH=1 additionally allows the old X-User-Id header (local testing only).
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
  sendJson(res, 200, { ...publicUser(u), phone: u.phone });
});

// ---------- creators (public — no phone numbers) ----------
app.get('/api/creators/:id', (req, res) => {
  const creator = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!creator) return sendJson(res, 404, { error: 'Not found' });
  const videos = db.prepare('SELECT * FROM videos WHERE user_id=? ORDER BY created_at DESC').all(creator.id);
  const products = db.prepare('SELECT * FROM products WHERE creator_id=? AND active=1').all(creator.id);
  const tipsTotal = Number(db.prepare(`
    SELECT COALESCE(SUM(amount),0) AS s FROM transactions WHERE type='tip' AND status='success' AND payee_user_id=?
  `).get(creator.id).s);
  sendJson(res, 200, { ...publicUser(creator), videos, products, tips_total: tipsTotal });
});

// ---------- feed ----------
// Recency + engagement. Deliberately simple: score = engagement / age^1.4
app.get('/api/feed', (req, res) => {
  const kind = req.query.kind === 'learn' ? 'learn' : 'watch';
  const rows = db.prepare(`
    SELECT v.*, u.name AS creator_name, u.handle AS creator_handle, u.color AS creator_color,
      (SELECT COUNT(*) FROM transactions t WHERE t.video_id=v.id AND t.type='tip' AND t.status='success') AS tip_count
    FROM videos v JOIN users u ON u.id = v.user_id
    WHERE v.kind = ?
    ORDER BY v.created_at DESC LIMIT 200
  `).all(kind);
  const now = Date.now() / 1000;
  for (const r of rows) {
    const ageHours = Math.max((now - Number(r.created_at)) / 3600, 0.1);
    r.score = (1 + Number(r.views) + Number(r.likes) * 3 + Number(r.tip_count) * 12) / Math.pow(ageHours + 2, 1.4);
  }
  rows.sort((a, b) => b.score - a.score);
  sendJson(res, 200, rows.slice(0, 50));
});

app.post('/api/videos/:id/view', (req, res) => {
  db.prepare('UPDATE videos SET views = views + 1 WHERE id=?').run(req.params.id);
  sendJson(res, 200, { ok: true });
});
app.post('/api/videos/:id/like', (req, res) => {
  db.prepare('UPDATE videos SET likes = likes + 1 WHERE id=?').run(req.params.id);
  sendJson(res, 200, { ok: true, likes: Number(db.prepare('SELECT likes FROM videos WHERE id=?').get(req.params.id)?.likes ?? 0) });
});

// ---------- upload (signed-in users only) ----------
app.post('/api/videos', async (req, res) => {
  const user = requireUser(req);
  const { fields, file } = await parseUpload(req, path.join(config.dataDir, 'tmp'));
  if (!file) return sendJson(res, 400, { error: 'No video file' });

  const filename = `v${Date.now()}.mp4`;
  const outPath = path.join(videosDir, filename);
  const { transcoded } = await transcode(file.path, outPath);
  fs.rmSync(file.path, { force: true });
  const duration = await probeDuration(outPath);
  const size = fs.statSync(outPath).size;

  const info = db.prepare(`
    INSERT INTO videos (user_id, title, kind, lang, filename, duration_s, size_bytes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(user.id, fields.title || 'Untitled', fields.kind === 'learn' ? 'learn' : 'watch', fields.lang || 'rw', filename, duration, size);
  sendJson(res, 200, { ...db.prepare('SELECT * FROM videos WHERE id=?').get(Number(info.lastInsertRowid)), transcoded });
});

// ---------- money: tips (no login needed — anyone with a MoMo number can tip) ----------
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

// ---------- money: wallet & withdrawals (signed-in) ----------
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
  // Payout binding: money can only leave to the phone this account signed up with.
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
  requireUser(req); // v1: any signed-in party can trigger; production restricts to admin/dispute flow
  sendJson(res, 200, refundOrder(Number(req.params.id)));
});

// ---------- content reports (Play UGC policy: in-app reporting) ----------
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

// ---------- static: videos (Range supported) + PWA ----------
app.static('/videos/', videosDir, 365 * 24 * 3600);
app.static('/', path.join(config.root, 'public'), 3600);

if (process.env.NODE_ENV !== 'test') {
  startSettlementWorker(1000);
  app.listen(config.port, () => {
    console.log(`Hobe running on http://localhost:${config.port}  (MoMo provider: ${provider.name})`);
  });
}

export { app };
