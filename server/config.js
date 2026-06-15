// All environment-driven config in one place.
// Going live with real MoMo = change MOMO_PROVIDER and fill the MTN_*/AIRTEL_* keys. Nothing else.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const config = {
  root,
  port: Number(process.env.PORT || 3000),
  dataDir: process.env.DATA_DIR || path.join(root, 'data'),

  // 'simulator' | 'mtn' | 'airtel'
  momoProvider: process.env.MOMO_PROVIDER || 'simulator',

  // Revenue splits (basis points so the maths is exact integers)
  tipCreatorBps: 8000,   // 80% to creator
  tipPlatformBps: 1500,  // 15% platform
  tipTxnCostBps: 500,    // 5% transaction costs
  storeCommissionBps: 400, // 4% commission on storefront sales (within the 3-5% brief)

  currency: 'RWF', // Rwandan franc, no decimal subunit — all amounts are integer RWF

  // MTN MoMo Open API (https://momodeveloper.mtn.com)
  mtn: {
    baseUrl: process.env.MTN_BASE_URL || 'https://sandbox.momodeveloper.mtn.com',
    targetEnv: process.env.MTN_TARGET_ENV || 'sandbox', // 'mtnrwanda' in production
    collectionsKey: process.env.MTN_COLLECTIONS_SUBSCRIPTION_KEY || '',
    disbursementsKey: process.env.MTN_DISBURSEMENTS_SUBSCRIPTION_KEY || '',
    apiUser: process.env.MTN_API_USER || '',
    apiKey: process.env.MTN_API_KEY || '',
    callbackHost: process.env.MTN_CALLBACK_HOST || 'https://example.com',
  },

  // Airtel Money Open API (https://developers.airtel.africa)
  airtel: {
    baseUrl: process.env.AIRTEL_BASE_URL || 'https://openapiuat.airtel.africa',
    clientId: process.env.AIRTEL_CLIENT_ID || '',
    clientSecret: process.env.AIRTEL_CLIENT_SECRET || '',
    country: 'RW',
    currency: 'RWF',
  },
};

export function splitTip(amount) {
  // Integer RWF. Platform and txn cost round down; creator takes the remainder,
  // so rounding always favours the creator and the three parts sum exactly.
  const platform = Math.floor((amount * config.tipPlatformBps) / 10000);
  const txnCost = Math.floor((amount * config.tipTxnCostBps) / 10000);
  const creator = amount - platform - txnCost;
  return { creator, platform, txnCost };
}

export function splitSale(amount) {
  const commission = Math.floor((amount * config.storeCommissionBps) / 10000);
  return { creator: amount - commission, commission };
}
