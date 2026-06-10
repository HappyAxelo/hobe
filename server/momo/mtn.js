// MTN MoMo Open API provider (Collections + Disbursements).
// Sandbox docs: https://momodeveloper.mtn.com
//
// To go live in Rwanda you need, per product (collections, disbursements):
//   1. A momodeveloper.mtn.com account and subscription keys (sandbox is free, self-serve)
//   2. For production: an MTN Rwanda MoMo merchant/partner agreement (via MTN Rwanda
//      business team), KYB documents, and production credentials issued by MTN
//   3. Set MTN_TARGET_ENV=mtnrwanda and MTN_BASE_URL=https://proxy.momoapi.mtn.com
//
// This file is complete against the sandbox API. It is exercised only when
// MOMO_PROVIDER=mtn and credentials are present.
import crypto from 'node:crypto';
import { config } from '../config.js';

const tokens = { collection: null, disbursement: null }; // { value, expiresAt }

async function getToken(product) {
  const cached = tokens[product];
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.value;

  const key = product === 'collection' ? config.mtn.collectionsKey : config.mtn.disbursementsKey;
  const basic = Buffer.from(`${config.mtn.apiUser}:${config.mtn.apiKey}`).toString('base64');
  const res = await fetch(`${config.mtn.baseUrl}/${product}/token/`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Ocp-Apim-Subscription-Key': key },
  });
  if (!res.ok) throw new Error(`MTN ${product} token failed: ${res.status} ${await res.text()}`);
  const body = await res.json();
  tokens[product] = { value: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return tokens[product].value;
}

async function call(product, method, path, { body, ref } = {}) {
  const key = product === 'collection' ? config.mtn.collectionsKey : config.mtn.disbursementsKey;
  const token = await getToken(product);
  const headers = {
    Authorization: `Bearer ${token}`,
    'Ocp-Apim-Subscription-Key': key,
    'X-Target-Environment': config.mtn.targetEnv,
    'Content-Type': 'application/json',
  };
  if (ref) headers['X-Reference-Id'] = ref;
  const res = await fetch(`${config.mtn.baseUrl}/${product}/${path}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok && res.status !== 202) {
    throw new Error(`MTN ${method} ${path} failed: ${res.status} ${await res.text()}`);
  }
  return res.status === 202 ? null : res.json().catch(() => null);
}

// MTN uses EUR in sandbox; RWF in production. One switch, here.
const CURRENCY = config.mtn.targetEnv === 'sandbox' ? 'EUR' : 'RWF';

export function createMtnProvider() {
  return {
    name: 'mtn',

    async requestToPay({ amount, payerPhone, externalId, memo }) {
      const ref = crypto.randomUUID();
      await call('collection', 'POST', 'v1_0/requesttopay', {
        ref,
        body: {
          amount: String(amount),
          currency: CURRENCY,
          externalId: String(externalId),
          payer: { partyIdType: 'MSISDN', partyId: payerPhone },
          payerMessage: memo ?? 'Hobe payment',
          payeeNote: memo ?? 'Hobe payment',
        },
      });
      return { providerRef: ref };
    },

    async transfer({ amount, payeePhone, externalId, memo }) {
      const ref = crypto.randomUUID();
      await call('disbursement', 'POST', 'v1_0/transfer', {
        ref,
        body: {
          amount: String(amount),
          currency: CURRENCY,
          externalId: String(externalId),
          payee: { partyIdType: 'MSISDN', partyId: payeePhone },
          payerMessage: memo ?? 'Hobe payout',
          payeeNote: memo ?? 'Hobe payout',
        },
      });
      return { providerRef: ref };
    },

    async getStatus(providerRef, { type } = {}) {
      // Withdrawals were created via disbursements; everything else via collections.
      const product = type === 'withdrawal' ? 'disbursement' : 'collection';
      const path = type === 'withdrawal' ? `v1_0/transfer/${providerRef}` : `v1_0/requesttopay/${providerRef}`;
      const body = await call(product, 'GET', path);
      // MTN statuses: PENDING | SUCCESSFUL | FAILED
      return { status: body?.status ?? 'PENDING', reason: body?.reason ?? null };
    },
  };
}
