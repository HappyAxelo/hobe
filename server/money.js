// All money movement. Transactions go out through the MoMo provider; once the
// provider confirms, the ledger is written atomically. Ledger is the source of
// truth for every balance — wallets are just SUM(amount) over an account.
import { db, getBalance, transaction } from './db.js';
import { splitTip, splitSale } from './config.js';
import { createProvider } from './momo/index.js';

export const provider = createProvider();

const insertTxn = db.prepare(`
  INSERT INTO transactions (type, status, amount, payer_phone, payer_user_id, payee_user_id, video_id, product_id, provider, provider_ref)
  VALUES (?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?)
`);
const insertLedger = db.prepare(`
  INSERT INTO ledger (txn_id, account, amount, kind, memo) VALUES (?, ?, ?, ?, ?)
`);
const getTxn = db.prepare('SELECT * FROM transactions WHERE id=?');

function newTxn({ type, amount, payerPhone = null, payerUserId = null, payeeUserId = null, videoId = null, productId = null, providerRef }) {
  const info = insertTxn.run(type, amount, payerPhone, payerUserId, payeeUserId, videoId, productId, provider.name, providerRef);
  return getTxn.get(Number(info.lastInsertRowid));
}

// ---------- Tips ----------
export async function startTip({ videoId, amount, payerPhone, payerUserId = null }) {
  const video = db.prepare('SELECT v.*, u.name AS creator_name FROM videos v JOIN users u ON u.id=v.user_id WHERE v.id=?').get(videoId);
  if (!video) throw httpErr(404, 'Video not found');
  if (!Number.isInteger(amount) || amount < 100) throw httpErr(400, 'Minimum tip is 100 RWF');

  const { providerRef } = await provider.requestToPay({
    amount, payerPhone, externalId: `tip-${videoId}-${Date.now()}`, memo: `Tip for ${video.creator_name} on Hobe`,
  });
  return newTxn({ type: 'tip', amount, payerPhone, payerUserId, payeeUserId: Number(video.user_id), videoId: Number(videoId), providerRef });
}

const settleTipLedger = transaction((txn) => {
  const { creator, platform, txnCost } = splitTip(txn.amount);
  insertLedger.run(txn.id, 'momo', -txn.amount, 'tip_in', `tip from ${txn.payer_phone}`);
  insertLedger.run(txn.id, `user:${txn.payee_user_id}`, creator, 'tip_split', 'creator 80%');
  insertLedger.run(txn.id, 'platform', platform, 'tip_split', 'platform 15%');
  insertLedger.run(txn.id, 'txncost', txnCost, 'tip_split', 'txn costs 5%');
  db.prepare("UPDATE transactions SET status='success', updated_at=unixepoch() WHERE id=?").run(txn.id);
});

// ---------- Storefront orders (escrow) ----------
export async function startOrder({ productId, payerPhone, buyerUserId }) {
  const product = db.prepare('SELECT p.* FROM products p WHERE p.id=? AND p.active=1').get(productId);
  if (!product) throw httpErr(404, 'Product not found');

  const { providerRef } = await provider.requestToPay({
    amount: Number(product.price), payerPhone, externalId: `order-${productId}-${Date.now()}`, memo: `Hobe order: ${product.title}`,
  });
  const txn = newTxn({
    type: 'order', amount: Number(product.price), payerPhone,
    payeeUserId: Number(product.creator_id), productId: Number(productId), providerRef,
  });
  const info = db.prepare(`
    INSERT INTO orders (product_id, buyer_user_id, buyer_phone, amount, status, txn_id)
    VALUES (?, ?, ?, ?, 'pending_payment', ?)
  `).run(Number(productId), buyerUserId ?? null, payerPhone, Number(product.price), txn.id);
  return db.prepare('SELECT * FROM orders WHERE id=?').get(Number(info.lastInsertRowid));
}

const settleOrderLedger = transaction((txn) => {
  // Money arrives but is HELD in escrow until the buyer confirms delivery.
  insertLedger.run(txn.id, 'momo', -txn.amount, 'escrow_hold', `order payment from ${txn.payer_phone}`);
  insertLedger.run(txn.id, 'escrow', txn.amount, 'escrow_hold', `held for product ${txn.product_id}`);
  db.prepare("UPDATE transactions SET status='success', updated_at=unixepoch() WHERE id=?").run(txn.id);
  db.prepare("UPDATE orders SET status='in_escrow', updated_at=unixepoch() WHERE txn_id=?").run(txn.id);
});

export const confirmDelivery = transaction((orderId) => {
  const order = db.prepare('SELECT o.*, p.creator_id FROM orders o JOIN products p ON p.id=o.product_id WHERE o.id=?').get(orderId);
  if (!order) throw httpErr(404, 'Order not found');
  if (order.status !== 'in_escrow') throw httpErr(409, `Order is '${order.status}', not in escrow`);
  const { creator, commission } = splitSale(Number(order.amount));
  insertLedger.run(order.txn_id, 'escrow', -order.amount, 'escrow_release', `release order ${orderId}`);
  insertLedger.run(order.txn_id, `user:${order.creator_id}`, creator, 'escrow_release', 'sale proceeds');
  insertLedger.run(order.txn_id, 'platform', commission, 'commission', 'storefront commission 4%');
  db.prepare("UPDATE orders SET status='released', updated_at=unixepoch() WHERE id=?").run(orderId);
  return db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
});

export const refundOrder = transaction((orderId) => {
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
  if (!order) throw httpErr(404, 'Order not found');
  if (order.status !== 'in_escrow') throw httpErr(409, `Order is '${order.status}', not in escrow`);
  // NOTE: in production this triggers a disbursement back to buyer_phone.
  insertLedger.run(order.txn_id, 'escrow', -order.amount, 'refund', `refund order ${orderId}`);
  insertLedger.run(order.txn_id, 'momo', order.amount, 'refund', `refund to ${order.buyer_phone}`);
  db.prepare("UPDATE orders SET status='refunded', updated_at=unixepoch() WHERE id=?").run(orderId);
  return db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
});

// ---------- Withdrawals (same-day cashout) ----------
export function availableBalance(userId) {
  const balance = getBalance(`user:${userId}`);
  const pendingOut = Number(db.prepare(`
    SELECT COALESCE(SUM(amount),0) AS s FROM transactions
    WHERE type='withdrawal' AND status='pending' AND payee_user_id=?
  `).get(userId).s);
  return { balance, pendingOut, available: balance - pendingOut };
}

export async function startWithdrawal({ userId, amount }) {
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(userId);
  if (!user) throw httpErr(404, 'User not found');
  if (!Number.isInteger(amount) || amount < 100) throw httpErr(400, 'Minimum withdrawal is 100 RWF');

  const { available } = availableBalance(userId);
  if (amount > available) throw httpErr(400, `Insufficient balance (available: ${available} RWF)`);

  const { providerRef } = await provider.transfer({
    amount, payeePhone: user.phone, externalId: `wd-${userId}-${Date.now()}`, memo: 'Hobe creator cashout',
  });
  return newTxn({ type: 'withdrawal', amount, payeeUserId: Number(userId), providerRef });
}

const settleWithdrawalLedger = transaction((txn) => {
  insertLedger.run(txn.id, `user:${txn.payee_user_id}`, -txn.amount, 'withdrawal', 'cashout to MoMo');
  insertLedger.run(txn.id, 'momo', txn.amount, 'withdrawal', 'sent to creator MoMo');
  db.prepare("UPDATE transactions SET status='success', updated_at=unixepoch() WHERE id=?").run(txn.id);
});

// ---------- Settlement worker ----------
// Polls the provider for pending transactions and settles the ledger when final.
// (With real MTN credentials you'd also accept their callback; polling still
// works and is what keeps sandbox + simulator behaviour identical.)
export async function settlePending() {
  const pending = db.prepare("SELECT * FROM transactions WHERE status='pending'").all();
  for (const txn of pending) {
    let result;
    try {
      result = await provider.getStatus(txn.provider_ref, { type: txn.type });
    } catch (e) {
      console.error(`status check failed for txn ${txn.id}:`, e.message);
      continue;
    }
    if (result.status === 'SUCCESSFUL') {
      if (txn.type === 'tip') settleTipLedger(txn);
      else if (txn.type === 'order') settleOrderLedger(txn);
      else if (txn.type === 'withdrawal') settleWithdrawalLedger(txn);
    } else if (result.status === 'FAILED') {
      db.prepare("UPDATE transactions SET status='failed', fail_reason=?, updated_at=unixepoch() WHERE id=?")
        .run(result.reason ?? 'unknown', txn.id);
      if (txn.type === 'order') {
        db.prepare("UPDATE orders SET status='failed', updated_at=unixepoch() WHERE txn_id=?").run(txn.id);
      }
    }
  }
}

export function startSettlementWorker(intervalMs = 1000) {
  const timer = setInterval(() => settlePending().catch((e) => console.error('settle worker:', e)), intervalMs);
  timer.unref();
  return timer;
}

function httpErr(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}
