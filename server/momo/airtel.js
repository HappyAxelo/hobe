// Airtel Money Open API provider — STUB with the real endpoint shapes documented.
// Docs: https://developers.airtel.africa
//
// Airtel Rwanda go-live needs: an Airtel Africa developer account (self-serve UAT),
// then a commercial agreement with Airtel Rwanda for production keys.
// Endpoints to implement (UAT base https://openapiuat.airtel.africa):
//   POST /auth/oauth2/token                      -> client_credentials token
//   POST /merchant/v1/payments/                  -> collections (USSD push to payer)
//   GET  /standard/v1/payments/{id}              -> collection status
//   POST /standard/v1/disbursements/             -> payout to wallet
//   GET  /standard/v1/disbursements/{id}         -> payout status
//
// The interface below matches simulator.js and mtn.js exactly, so completing it
// is filling in four fetch calls — no changes anywhere else in the codebase.
export function createAirtelProvider() {
  const notReady = () => {
    throw new Error('Airtel provider not implemented yet. Set MOMO_PROVIDER=simulator or =mtn. See server/momo/airtel.js for the endpoints to fill in.');
  };
  return {
    name: 'airtel',
    async requestToPay() { notReady(); },
    async transfer() { notReady(); },
    async getStatus() { notReady(); },
  };
}
