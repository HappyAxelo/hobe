// End-to-end test of the core money loop against the simulator:
//   tip -> 80/15/5 split -> creator wallet -> withdrawal -> ledger balances to zero
// Plus the escrow flow: order -> hold -> confirm delivery -> release minus 4%.
process.env.NODE_ENV = 'test';
process.env.MOMO_PROVIDER = 'simulator';
process.env.DATA_DIR ||= new URL('./tmpdata', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });

const { db, getBalance } = await import('../server/db.js');
const { startTip, startOrder, startWithdrawal, confirmDelivery, settlePending } = await import('../server/money.js');
const { splitTip, splitSale } = await import('../server/config.js');

// minimal fixtures
const creatorId = db.prepare("INSERT INTO users (name, handle, phone, role) VALUES ('Test Creator','tc','250788111222','creator')").run().lastInsertRowid;
const videoId = db.prepare("INSERT INTO videos (user_id, title, filename) VALUES (?, 'vid', 'x.mp4')").run(creatorId).lastInsertRowid;
const productId = db.prepare("INSERT INTO products (creator_id, title, price) VALUES (?, 'bag', 8500)").run(creatorId).lastInsertRowid;

async function settleUntilDone(txnId, ms = 4000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    await settlePending();
    const t = db.prepare('SELECT status FROM transactions WHERE id=?').get(txnId);
    if (t.status !== 'pending') return t.status;
    await new Promise((r) => setTimeout(r, 150));
  }
  return 'pending';
}

test('tip splits 80/15/5 and lands in creator wallet', async () => {
  const txn = await startTip({ videoId, amount: 1000, payerPhone: '250788999000' });
  assert.equal(txn.status, 'pending');
  assert.equal(await settleUntilDone(txn.id), 'success');

  const split = splitTip(1000);
  assert.deepEqual(split, { creator: 800, platform: 150, txnCost: 50 });
  assert.equal(getBalance(`user:${creatorId}`), 800);
  assert.equal(getBalance('platform'), 150);
  assert.equal(getBalance('txncost'), 50);
});

test('odd amounts still sum exactly, rounding favours creator', async () => {
  const s = splitTip(333); // 15% = 49.95 -> 49, 5% = 16.65 -> 16, creator = 268
  assert.equal(s.creator + s.platform + s.txnCost, 333);
  assert.equal(s.platform, 49);
  assert.equal(s.txnCost, 16);
  assert.equal(s.creator, 268);
});

test('failed payment (phone ending 99) writes no ledger entries', async () => {
  const before = db.prepare('SELECT COUNT(*) c FROM ledger').get().c;
  const txn = await startTip({ videoId, amount: 500, payerPhone: '250788000099' });
  assert.equal(await settleUntilDone(txn.id), 'failed');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM ledger').get().c, before);
});

test('withdrawal: creator cashes out, cannot overdraw', async () => {
  const balance = getBalance(`user:${creatorId}`); // 800 from the first tip
  await assert.rejects(() => startWithdrawal({ userId: creatorId, amount: balance + 1 }), /Insufficient/);

  const txn = await startWithdrawal({ userId: creatorId, amount: balance });
  assert.equal(await settleUntilDone(txn.id), 'success');
  assert.equal(getBalance(`user:${creatorId}`), 0);
});

test('escrow: order held, released minus 4% on delivery confirmation', async () => {
  const order = await startOrder({ productId, payerPhone: '250788999000' });
  assert.equal(order.status, 'pending_payment');
  assert.equal(await settleUntilDone(order.txn_id), 'success');

  let o = db.prepare('SELECT * FROM orders WHERE id=?').get(order.id);
  assert.equal(o.status, 'in_escrow');
  assert.equal(getBalance('escrow'), 8500);

  const creatorBefore = getBalance(`user:${creatorId}`);
  o = confirmDelivery(order.id);
  assert.equal(o.status, 'released');
  assert.equal(getBalance('escrow'), 0);

  const { creator, commission } = splitSale(8500);
  assert.equal(creator, 8160);
  assert.equal(commission, 340);
  assert.equal(getBalance(`user:${creatorId}`), creatorBefore + 8160);
});

test('ledger is internally consistent: every txn sums to zero', () => {
  const rows = db.prepare('SELECT txn_id, SUM(amount) s FROM ledger GROUP BY txn_id').all();
  for (const r of rows) assert.equal(r.s, 0, `txn ${r.txn_id} does not balance`);
})