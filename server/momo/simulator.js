// Local MoMo simulator. Mirrors the shape of the MTN provider exactly so that
// switching MOMO_PROVIDER=mtn is the only change needed to go to real rails.
//
// Behaviour rules (for demos and tests):
//   - phone ending in '99'  -> payment/payout FAILS (insufficient funds)
//   - phone ending in '77'  -> stays PENDING forever (timeout path)
//   - anything else         -> succeeds after ~1.5s
import crypto from 'node:crypto';

const state = new Map(); // ref -> { status, resolveAt, failReason }

function decide(phone) {
  if (phone?.endsWith('99')) return { final: 'FAILED', reason: 'PAYER_INSUFFICIENT_FUNDS' };
  if (phone?.endsWith('77')) return { final: 'PENDING', reason: null };
  return { final: 'SUCCESSFUL', reason: null };
}

function start(phone) {
  const ref = crypto.randomUUID();
  const { final, reason } = decide(phone);
  state.set(ref, { status: 'PENDING', final, failReason: reason, resolveAt: Date.now() + 1500 });
  return ref;
}

export function createSimulatorProvider() {
  return {
    name: 'simulator',

    // Collections: pull money from a payer's MoMo wallet (tip / purchase)
    async requestToPay({ amount, payerPhone, externalId, memo }) {
      void amount; void externalId; void memo;
      return { providerRef: start(payerPhone) };
    },

    // Disbursements: push money out to a MoMo number (creator cashout)
    async transfer({ amount, payeePhone, externalId, memo }) {
      void amount; void externalId; void memo;
      return { providerRef: start(payeePhone) };
    },

    // Poll a transaction. Returns 'PENDING' | 'SUCCESSFUL' | 'FAILED'
    async getStatus(providerRef) {
      const s = state.get(providerRef);
      if (!s) return { status: 'FAILED', reason: 'NOT_FOUND' };
      if (s.status === 'PENDING' && Date.now() >= s.resolveAt && s.final !== 'PENDING') {
        s.status = s.final;
      }
      return { status: s.status, reason: s.status === 'FAILED' ? s.failReason : null };
    },
  };
}
