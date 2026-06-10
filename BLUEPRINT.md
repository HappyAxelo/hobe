# Hobe — Production Blueprint

MVP system design and product spec. Rwanda first. The success test is one sentence: a viewer sends money, the creator receives it, the creator withdraws it to MoMo. Everything else is secondary.

A working skeleton of this design already exists in this repo (tested money loop, PWA feed, provider adapter). This document is the blueprint that build follows and extends.

---

## 1. Product Re-architecture

### Weaknesses in the original concept

1. **Five features, one product.** Feed, tipping, storefront, micro-learning and P2P sharing compete for build time. Only tipping + cashout is the product; the rest is surface area. The feed exists to create tipping moments.
2. **Custody is the hidden iceberg.** Holding creator balances makes Hobe an e-money issuer under BNR Regulation 74/2023. That is a licensing project, not a feature. The MVP must be designed so the custody window is small and a non-custodial fallback exists (§8).
3. **Micro-tip unit economics are fragile.** A 100 RWF tip carries a fixed MoMo collection cost. At small amounts the operator fee can exceed the 5% cost budget. The MVP needs a minimum tip (500 RWF) and a planned move to viewer wallet top-ups, where one collection funds many tips (§4).
4. **Escrow commerce imports dispute operations.** Every escrow order can become a customer-service case. Build the flow, cap exposure (order value limit, auto-release timer), and don't market it until tipping has traction.
5. **Micro-learning is not a feature, it's a tag.** Same player, same upload path, a `kind` field and a second tab. Treating it as a separate system would be wasted effort.
6. **Wi-Fi Direct is impossible in a browser.** No web API exists. Honest plan: Web Share API hands the video file to Android's share sheet (Quick Share/Bluetooth, no data) now; true Wi-Fi Direct comes with the TWA native wrapper later.
7. **Missing entirely from the original: auth, moderation, admin.** A money app needs OTP login bound to the MoMo number, a takedown path for content, and an ops console from day one.

### Build now / defer

| Phase | Scope |
|---|---|
| **Now (MVP)** | Vertical feed + upload + transcode; tip → 80/15/5 split → wallet → same-day cashout; OTP auth on MoMo number; double-entry ledger; admin console (read ledger, freeze user, takedown video); Learn tab as a tag |
| **Next (v1.1)** | Viewer wallet top-ups (fee batching); storefront escrow with auto-release timer; creator analytics; referral loop ("creator invites creator") |
| **Later** | TWA wrapper (push notifications, Wi-Fi Direct); AV1 second rendition; Airtel Money live; second country; ads/boosts as second revenue line |

---

## 2. System Architecture

### Shape: modular monolith

One deployable Node service, modules with hard internal boundaries (`feed`, `media`, `money`, `identity`, `admin`). Microservices at this stage would add network failure modes to a money system that needs atomic writes. The only piece that must be isolated early is transcoding (CPU-heavy): run it as a worker process pulling from a job table, same codebase.

```
[Android phone / PWA]
   │  HTTPS
   ▼
[CDN: Bunny] ── video segments, app shell (cache-first)
   │  cache miss
   ▼
[Object storage: Cloudflare R2] ◄── [Transcode worker (ffmpeg)]
                                         ▲ job table
[App server (Fly.io jnb, Node monolith)]─┘
   │ modules: feed │ media │ money │ identity │ admin
   ▼
[Postgres]  (SQLite in dev — same SQL)
   │
[Settlement worker] ◄─poll/webhook─► [MoMo adapter: MTN | Airtel | simulator]
```

### Module responsibilities

| Module | Owns |
|---|---|
| identity | OTP login (SMS to MoMo number), sessions, KYC tier flags |
| feed | Ranking (recency × engagement), views, likes |
| media | Upload, transcode jobs, storage keys, CDN URLs |
| money | Transactions, ledger, splits, escrow, settlement worker, provider adapter |
| admin | Ledger browser, user freeze, video takedown, payout review queue |

### Wallet and transaction design

Two-table core. `transactions` is the provider-facing record (one row per external money movement, with provider reference and status machine `pending → success | failed`). `ledger` is double-entry: every settled transaction writes balanced rows summing to zero across accounts (`user:N`, `platform`, `txncost`, `escrow`, `momo` for the external world). Balances are always `SUM(amount)` over an account. There is no balance column anywhere, so there is nothing to drift. Settlement is the only writer of ledger rows and runs idempotently.

### Escrow v1

Order paid → funds credited to `escrow` account → buyer confirms delivery → `escrow` debited, creator credited minus 4%, platform credited. Refund path mirrors it. v1.1 adds an auto-release timer (7 days after creator marks shipped, absent a dispute) so money never sits in escrow indefinitely. Order value cap 50,000 RWF until dispute ops exist.

### Admin/ops

Internal-only console: search any account's ledger, freeze a user (blocks withdrawals, not viewing), takedown videos, view a payout review queue (withdrawals above a threshold, e.g. 100,000 RWF/day, pause for manual approval). All admin actions are themselves audit-logged.

---

## 3. Technical Decisions

### A. Video hosting and delivery

**Decision: Cloudflare R2 (storage) + Bunny CDN (delivery), app server on Fly.io Johannesburg.**

The killer cost in Africa is egress and international transit. So: pay for storage once with zero egress (R2, $0.015/GB-month), serve from PoPs on the continent (Bunny: Johannesburg, Lagos, Nairobi, $0.06/GB Africa rate).

Cost per 1,000 plays (one play ≈ a 60 s clip ≈ 3.5 MB at our bitrate; 1,000 plays ≈ 3.5 GB):

| Option | $/GB (Africa) | Per 1,000 plays | Notes |
|---|---|---|---|
| **Bunny CDN + R2 origin** | 0.06 | **$0.21** | African PoPs; R2 egress free |
| CloudFront + S3 | ~0.11 + S3 egress | ~$0.40+ | Fewer African PoPs; origin egress billed |
| Cloudflare CDN + R2 | ~0 (bundled) | ~$0 marginal | Tempting, but video delivery on free/Pro tiers breaches ToS at scale; Stream product costs more |
| Local RW hosting | n/a | higher | No in-country provider beats CDN economics today; KigaliX peering makes Joburg PoPs fast; revisit at scale |

At 10,000 DAU × 20 plays/day ≈ 21 TB/month ≈ **$1,260/month** delivery. The MVP serves video from its own disk with HTTP Range support; moving to R2+Bunny is a URL prefix change.

### B. Video compression

**Decision: H.264 Baseline, 480×854, CRF 27 capped at 450 kbps, 30 fps, 48 kbps mono AAC, `+faststart`.**

| Codec | Compression | Low-end Android decode | Verdict |
|---|---|---|---|
| **H.264 Baseline** | baseline | Hardware on effectively every device ever sold | **Ship it** |
| H.265 | ~40% better | Patchy below mid-range; software fallback stutters and drains battery | Defer |
| AV1 | ~50% better | Hardware only on newer SoCs; dav1d software decode is decent but warm | Add as second rendition when analytics justify it |

A 60-second clip is ~3.5 MB and streams in real time on a 0.7 Mbps 3G link with jitter headroom. `+faststart` makes playback start before the download completes. Every upload is re-encoded server-side through this exact pipeline; no client-supplied encoding is trusted.

### C. Mobile Money integration

**Decision: direct MTN MoMo Open API behind a provider adapter. Airtel direct as the second implementation. No aggregator.**

| Route | Per-txn fee | Time to sandbox | Time to production | Coverage |
|---|---|---|---|---|
| **MTN direct** | Operator fees only | Same day (self-serve, free) | Weeks–months: MTN RW partner agreement, KYB | MTN (~80% of RW mobile money) |
| Airtel direct | Operator fees only | Self-serve UAT | Commercial agreement with Airtel RW | Remainder of market |
| Flutterwave / Paypack / CinetPay / Pesapal | ~1.4–3% | Days | Days–weeks (their licence umbrella) | Both networks, one contract |

Why not the aggregator, despite faster go-live: on a 500 RWF tip the entire transaction-cost budget (5%) is 25 RWF; an aggregator's cut consumes or exceeds it, permanently, on every micro-transaction. Micro-tips are the business, so the rails must be the cheapest possible. The adapter interface (`requestToPay`, `transfer`, `getStatus`) keeps the aggregator as a plug-in fallback if MTN's commercial process stalls — that decision is one config value, already implemented with three providers (simulator, MTN, Airtel stub).

Sandbox strategy: local simulator is the default (deterministic failure cases: payer number ending 99 fails, 77 hangs), MTN sandbox exercises the real client with `MOMO_PROVIDER=mtn`. The sandbox bills EUR; the client switches currency automatically by target environment.

---

## 4. Core Money Loop

### Tip flow

```
viewer taps tip (≥500 RWF)
→ POST /api/tips                        txn row created: pending
→ adapter.requestToPay()                MoMo USSD prompt on payer's phone
→ payer approves on phone
→ settlement worker (poll 1s + webhook) sees SUCCESSFUL
→ ONE atomic DB transaction writes the ledger:
     momo        −1000   (money entered the system)
     user:N       +800   (creator, 80%)
     platform     +150   (15%)
     txncost       +50   (5%)
   and marks txn success
→ creator wallet reflects it instantly (balance = SUM over ledger)
```

Splits are computed in integer RWF (no decimal subunit exists). Platform and cost shares round down; the creator takes the remainder, so rounding always favours the creator and the three parts sum exactly. Failed or abandoned payments write zero ledger rows.

### Withdrawal flow (same-day cashout)

```
creator taps cash out
→ available = SUM(user:N) − pending withdrawals   (prevents double-spend race)
→ reject if amount > available
→ adapter.transfer() (disbursement to creator's own MoMo number — the one
  they logged in with; payouts to third-party numbers are not allowed)
→ on SUCCESSFUL: ledger writes user:N −X, momo +X
→ on FAILED: nothing was ever debited; balance intact
```

### Ledger rules (no fake balances)

1. Double-entry: every settled transaction's rows sum to zero. Enforced by an automated invariant test and a nightly reconciliation job.
2. No mutable balance columns. Balance is a query, never a stored number.
3. Only the settlement worker writes ledger rows, only after provider confirmation, only inside a DB transaction.
4. Idempotency: provider references are unique; replayed webhooks and double polls are no-ops.
5. Reconciliation: nightly job compares the `momo` account against the provider's statement; any mismatch pages a human.

### Fraud protection (MVP-level)

| Control | Rule |
|---|---|
| Velocity | Max tips/hour per payer number; max withdrawal/day per creator |
| Payout binding | Withdrawals only to the OTP-verified login number |
| Review queue | Withdrawals > 100k RWF/day held for manual approval |
| Self-tipping | Flag payer number == creator number and circular patterns (A tips B, B tips A) |
| KYC tiers | Tier 0 (OTP only): low limits. Tier 1 (ID doc): raised limits. Mirrors MoMo's own tiering |
| Escrow caps | 50k RWF order cap; auto-release timer; refund path tested |

---

## 5. Data Model

Nine tables. Implemented and tested.

| Table | Key fields | Notes |
|---|---|---|
| users | id, name, handle, **phone** (MoMo number = identity), role, kyc_tier | One table for viewers and creators; `role` flag |
| videos | id, user_id, title, **kind** (watch/learn), lang, filename, duration, views, likes | Learn tab is `kind='learn'` |
| products | id, creator_id, title, price (int RWF), active | Storefront items |
| transactions | id, **type** (tip/order/withdrawal), **status** (pending/success/failed), amount, payer_phone, payee_user_id, provider, **provider_ref** (unique), fail_reason | Provider-facing record |
| ledger | id, txn_id, **account**, amount (signed int), kind, memo | Double-entry; source of truth |
| orders | id, product_id, buyer_user_id, buyer_phone, amount, **status** (pending_payment/in_escrow/released/refunded/failed), txn_id | Escrow state machine |
| sessions | user_id, token, expires | OTP auth (to build) |
| transcode_jobs | id, video_id, status | Worker queue (to split out) |
| admin_audit | admin_id, action, target, at | Every admin act logged (to build) |

Accounts in `ledger`: `user:<id>`, `platform`, `txncost`, `escrow`, `momo`. Adding a new money flow means defining its balanced ledger writes, nothing more.

---

## 6. Build Plan

The repo already contains a working skeleton: money loop with passing tests, PWA feed, transcode pipeline, provider adapter, seed data. The plan below hardens it to production.

| Days | Work | Exit test |
|---|---|---|
| 1–3 | MTN sandbox credentials in; real `requestToPay`/`transfer` round-trips; webhook receiver + poll reconciliation | Tip and payout complete against MTN sandbox |
| 4–6 | OTP auth (SMS via MTN/local gateway) replacing demo user switcher; sessions; payout binding to login number | Cannot withdraw to a number you didn't log in with |
| 7–10 | Admin console v1 (ledger browser, freeze, takedown, payout queue); velocity limits; nightly reconciliation job | Ops can answer "where is this money?" in <1 min |
| 11–14 | Deploy: Fly.io jnb + Postgres migration (schema is portable SQL); R2 + Bunny for video; real-device testing on a low-end Android over throttled 3G | **Public URL; full loop on a $60 phone on 3G** |
| 15–21 | Closed pilot: 10–20 Kigali creators, real sandbox→production cutover when MTN agreement lands; escrow auto-release timer; crash/error reporting | First real creator paid out same day |
| 22–28 | Storefront polish, creator analytics page, referral mechanics; load test feed + settlement worker | 1k concurrent viewers without settlement lag |

Deploy order on day one of production credentials: money module first, behind a feature flag, with the simulator still available for staging. The feed can be mediocre for months; the ledger cannot be wrong once.

---

## 7. Rwanda-first Constraints (how the design answers each)

| Constraint | Design answer |
|---|---|
| 3G bandwidth | 450 kbps cap ⇒ real-time streaming at 0.7 Mbps; `+faststart`; preload only the active clip |
| Low-end Android | H.264 Baseline hardware decode; no framework JS (~tens of KB shell); no animations on the hot path |
| High data cost | ~3.5 MB/minute of video; shell cached by service worker after first visit; thumbnails not auto-loaded on Learn tab |
| Intermittent connectivity | Service worker shell offline; saved-video cache; settlement is server-side so a dropped client never loses money state; pending txns resolve when the prompt is approved, even if the viewer's app is closed |
| MoMo dominance | Phone number is the identity, the login, and the payout destination; no cards anywhere |
| Cheap sharing culture | Web Share hands the actual MP4 to Android's share sheet (Bluetooth/Quick Share, zero data); TWA wrapper later for Wi-Fi Direct |

---

## 8. Risks and Regulatory Notes

**Licensing (the big one).** Holding creator balances and escrow funds makes Hobe an e-money issuer / PSP under BNR Regulation 74/2023: local incorporation, RWF 30M–300M initial capital by category, trust account at a licensed commercial bank with segregated and traceable customer funds, AML/CFT programme, governance requirements. Three postures, in order of preference:

1. **Partner umbrella now, own licence in parallel.** Launch under a licensed local PSP's umbrella while applying. Fastest legal route to holding balances.
2. **Own licence first.** Slowest, but the licence is the moat; this is the actual business.
3. **Non-custodial fallback.** If neither is ready: pass-through mode — every tip immediately disburses the creator's 80% to their MoMo, no stored balance. Higher per-txn fees, no wallet feature, but no custody. The ledger design supports this as a configuration of when `transfer` fires, not a rewrite.

**Escrow** is consumer protection territory: written dispute policy, auto-release timer, order caps, refund path tested before real merchandise moves.

**AML/KYC.** Velocity limits and KYC tiers from day one; suspicious-activity reporting once licensed. Tipping platforms attract money-mule patterns (many small in, one large out) — the review queue exists for this.

**Tax.** Platform commission likely attracts 18% VAT; creator earnings raise withholding questions. Engage a Rwandan accountant before production money flows.

**What the MVP must avoid.** Holding real customer money without a licence or umbrella. Payouts to numbers other than the verified login number. Any credit/advance feature ("borrow against future tips") — that is a lending licence. Cross-border flows — single country until licensed for more. Storing card data — there are no cards in this product.

---

## Key principle, restated

Ship the loop: money in → split → wallet → MoMo payout, same day, with a ledger that always sums to zero. The feed earns attention; the loop earns trust; trust is the product.
