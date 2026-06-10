# Hobe

Short videos. Real money. A creator in Kigali posts a video, a viewer tips 500 RWF over Mobile Money, 400 RWF lands in the creator's Hobe wallet within seconds, and they cash out to their own MoMo number the same day. That loop is built, tested, and running.

## Run it

You need Node 22.5 or newer. Nothing else — there are zero npm dependencies, so there is no `npm install` step. ffmpeg is optional but recommended (it recompresses uploads; demo videos are pre-rendered in `seed-assets/` so seeding works without it).

```
node scripts/seed.js     # load demo creators, videos, products
node server/index.js     # start on http://localhost:3000
```

To open it on your phone, put the phone on the same Wi-Fi as your computer and browse to `http://<your-computer-ip>:3000`. Chrome on Android will offer "Add to Home screen" — it installs as a full-screen app. To put it on the public internet, `fly launch --copy-config --now` from this folder deploys it to Fly.io's Johannesburg region (the `fly.toml` and `Dockerfile` are ready; you need a Fly account).

Run the test suite with `npm test`. Six tests cover the money loop: the 80/15/5 split, exact rounding on odd amounts, failed payments writing nothing, overdraw rejection, escrow release minus 4%, and the invariant that every transaction's ledger entries sum to zero.

## The demo script

Sign in as **Happy** (the viewer) via the pill at the top right. Tip 1,000 RWF on Aline's dance video — watch the MoMo flow complete. Switch to **Aline Uwase**, open Wallet: 800 RWF is there, with the ledger entry. Tap "Cash out now": the money goes to her MoMo number, balance returns to zero. That is the whole pitch in 30 seconds.

For the storefront: as Happy, open Market, buy Diane's kitenge bag (8,500 RWF). The payment lands in escrow. Tap "I received it" under Your orders — Diane's wallet gains 8,160 RWF (the 4% commission goes to the platform).

The simulator gives you failure cases on demand: a payer number ending **99** fails (insufficient funds), ending **77** hangs forever (the abandoned-prompt path). Anything else succeeds after about two seconds.

## The three decisions you asked me to make

**MoMo integration: direct MTN MoMo Open API, behind an adapter.** Aggregators (Flutterwave, Paypack, Pesapal) cover both networks with one contract, but they charge roughly 1.4–3% per transaction. On a 500 RWF tip your whole 5% transaction-cost budget is 25 RWF; an aggregator's cut alone can exceed that, and micro-tips are the core of this business. MTN's direct API has no aggregator margin, a free self-serve sandbox, and MTN holds the large majority of Rwanda's mobile money market, so it's the right first rail. The code talks to an interface (`requestToPay`, `transfer`, `getStatus`), with three implementations: a local simulator (default), a complete MTN client, and an Airtel stub with the exact endpoints documented. Going live is one config change: `MOMO_PROVIDER=mtn` plus credentials. Airtel comes second, also direct — its developer API is self-serve for UAT too.

**Video delivery: Cloudflare R2 for storage + Bunny CDN for delivery; Fly.io Johannesburg for the app server.** International bandwidth is the cost that kills you, so the rule is: pay for storage once, never pay egress, and serve from PoPs on the continent. R2 charges $0.015/GB-month for storage and nothing for egress. Bunny has African PoPs (Johannesburg, Lagos, Nairobi among them) at $0.06/GB for African traffic, and its Stream product starts around $0.01/GB for volume tiers. Rough numbers: 10,000 daily viewers watching 20 videos a day at ~3.5 MB each is about 21 TB/month — roughly $1,260/month on Bunny's Africa rate, versus $1,800+ on CloudFront before request fees, and AWS would also bill you to get the bytes out of S3. In-country hosting (e.g. via RICTA-connected ISPs) is worth revisiting at scale for Kigali latency, but no Rwandan host beats this on price today, and KigaliX peering means Johannesburg/CDN PoPs are already fast. The MVP serves video from its own disk with HTTP Range support; pointing the video URLs at a CDN is a one-line change when you outgrow that.

**Codec: H.264 Baseline profile, 480×854, capped at 450 kbps + 48 kbps mono AAC.** H.264 is the only codec with hardware decoding on effectively every Android phone ever sold, including sub-$60 handsets. HEVC and AV1 compress 30–50% better, but on cheap phones without hardware decoders they fall back to software decoding, which stutters and drains the battery — precisely the phones we target. Baseline profile (not Main/High) is the conservative choice for the oldest chips. At these settings a 60-second clip is ~3.5 MB and streams in real time on a 0.7 Mbps 3G link with headroom. `+faststart` puts the index at the front of the file so playback begins before the download finishes. The server recompresses every upload through this pipeline (`server/transcode.js`). AV1 becomes a second rendition worth adding when your analytics show enough hardware-AV1 devices.

**PWA, not native — for now.** The whole app is one HTML file, one JS file (no framework), and one CSS file: a few tens of KB before video, fine on 3G. It installs from Chrome, plays video, takes uploads from the camera, and caches the shell offline via a service worker. Native becomes necessary only for Wi-Fi Direct (below) and push notifications.

## What's built

The tipping loop end to end: tip → MoMo collection → 80/15/5 ledger split → creator wallet → same-day disbursement to the creator's MoMo number. A double-entry ledger as the single source of truth for all balances, with platform and transaction-cost accounts. The vertical swipe feed with autoplay, view counting, likes, and a recency-plus-engagement ranking. Upload from the phone with server-side recompression. Creator profiles with tip totals. The storefront with a working escrow flow: payment held, released minus 4% on buyer confirmation, refund path included. The Learn tab as a second feed of lessons tagged by language. A complete MTN MoMo client ready for sandbox credentials. Seed data: three creators, seven videos, three products, one viewer account.

## What's stubbed, and honestly why

**Wi-Fi Direct P2P sharing is stubbed.** Browsers cannot touch Wi-Fi Direct — there is no web API for it, full stop, and faking it would have been dishonest. What you get instead: the share button hands the actual video file to Android's native share sheet (Web Share API level 2), which on most Android phones reaches Quick Share/Bluetooth — phone-to-phone with no cellular data. There's also "save offline" via the service worker cache. True Wi-Fi Direct needs a thin native wrapper: package this PWA in a TWA (Trusted Web Activity) and add one Android plugin for Wi-Fi Direct file transfer. That's a contained, well-trodden job, not a rewrite.

**Auth is a demo user-switcher.** Real login should be OTP over SMS keyed to the MoMo number — the phone number is already the financial identity. The `X-User-Id` header is isolated in one function in `server/index.js`.

**Airtel Money is an interface stub** with the real UAT endpoints documented in `server/momo/airtel.js`. Filling it in is four fetch calls; nothing else in the codebase changes.

**Delivery confirmation is manual** (buyer taps "I received it"). Production wants courier integration or OTP-on-delivery before this handles real disputes.

## What you must obtain to go live

For MTN sandbox (free, ~30 minutes): an account at momodeveloper.mtn.com, subscriptions to the Collections and Disbursements products (two subscription keys), then create an API user and key via their provisioning API. Put the values in `.env` (see `.env.example`) and set `MOMO_PROVIDER=mtn`. Note the sandbox bills in EUR; the code switches to RWF automatically when `MTN_TARGET_ENV` is not `sandbox`.

For MTN production: a registered Rwandan company, an MTN Rwanda MoMo API partner agreement (through their business team — expect KYB documents and a revenue discussion), and production credentials. For Airtel: a developer account at developers.airtel.africa for UAT, then a commercial agreement with Airtel Rwanda.

**The licence question, flagged as promised.** Hobe holds creator balances between tip and cashout, and holds buyer money in escrow. Under Rwanda's Regulation No. 74/2023 on Payment Service Providers, that almost certainly makes Hobe an e-money issuer / PSP requiring a BNR licence: local incorporation, initial capital between RWF 30M and 300M depending on category, a trust account at a licensed commercial bank with customer funds segregated and traceable, AML/CFT compliance, and governance requirements. Two ways forward: apply for the licence (the durable moat — this is the business), or launch under a licensed partner's umbrella (some local PSPs offer this) while the application runs. A third option that avoids the licence initially: pass tips through to the creator's MoMo instantly with no stored balance — less product, less regulation. Talk to a Kigali fintech lawyer before holding real money. None of this blocks the prototype.

## How it's put together

No frameworks, no npm packages — Node's built-in SQLite (`node:sqlite`) and HTTP server, plus ~150 lines of router and a streaming multipart parser. That's deliberate: nothing to install on any machine, no supply chain, and a codebase a single developer can hold in their head. `server/money.js` is the heart — read it first. Every balance is `SUM(amount)` over ledger rows; there are no mutable balance columns to drift. A settlement worker polls the payment provider once a second and writes the ledger only when the provider confirms, atomically. Amounts are integer RWF throughout; rounding on splits always favours the creator.

```
server/
  index.js      routes + static serving (Range-capable, for video)
  money.js      tips, escrow, withdrawals, settlement worker
  db.js         schema + ledger helpers
  momo/         simulator | mtn | airtel behind one interface
  transcode.js  the H.264 3G pipeline
public/         the PWA (index.html, app.js, style.css, sw.js)
scripts/seed.js demo data
test/           money-loop tests
```
