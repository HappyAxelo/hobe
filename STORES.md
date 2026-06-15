# Shipping Hobe to the app stores

The app is a PWA, so the store strategy is: deploy it to a public HTTPS URL, then wrap that URL. Google Play accepts this directly (Trusted Web Activity). Apple needs more — see the iOS section before spending $99.

Everything below assumes commands run on your Windows PC, in this folder.

---

## Step 1 — Deploy the backend (prerequisite for everything)

A store app on someone's phone cannot reach `localhost`. Deploy to Fly.io (Johannesburg region, closest to Rwanda; a small instance costs a few dollars a month, often less at pilot traffic):

1. Create an account at https://fly.io
2. Install the CLI: in PowerShell run
   `iwr https://fly.io/install.ps1 -useb | iex`
3. Sign in: `fly auth login`
4. From this folder: `fly launch --copy-config --now`
   (accepts the bundled `fly.toml` and `Dockerfile`; demo data seeds itself)
5. Note your URL, e.g. `https://hobe.fly.dev` — open it on your phone to confirm.

Keep `MOMO_PROVIDER=simulator` until you have MTN credentials (`fly secrets set MOMO_PROVIDER=mtn MTN_...=...` later — that's the whole go-live switch).

## Step 2 — Build the Android app (Bubblewrap, no Android Studio needed)

1. Install Bubblewrap: `npm i -g @bubblewrap/cli`
   (first run offers to download the JDK and Android SDK for you — say yes)
2. In `twa-manifest.json`, replace every `REPLACE.fly.dev` with your real domain.
3. `bubblewrap build`
   - It generates a signing keystore (`android.keystore`). **Back this file and its passwords up properly — losing it means you can never update the app again.**
   - Output: `app-release-bundle.aab` (for Play) and an `.apk` you can install on your phone right now to test.
4. The build prints a **SHA-256 fingerprint**. Put it in `public/.well-known/assetlinks.json` (replacing the placeholder), then redeploy: `fly deploy`.
   This is what removes the browser bar — Android verifies your app owns the domain. Verify at:
   `https://YOUR-DOMAIN/.well-known/assetlinks.json`

## Step 3 — Google Play Console

1. Register at https://play.google.com/console — $25 one-off. Identity verification can take a few days.
2. Create app → upload `app-release-bundle.aab` to **Internal testing** first (sanity-check on real phones), then promote to Production.
3. Store listing needs:
   - Privacy policy URL: `https://YOUR-DOMAIN/privacy.html` (already built and served)
   - App icon 512×512: `public/icons/icon-512.png`
   - Feature graphic 1024×500: `store-assets/feature-graphic.png` (generated)
   - At least 2 phone screenshots: take them from the installed app (feed, wallet, tip sheet are the good ones)
4. **Declarations that matter for this app** (App content section):
   - *User-generated content*: declare YES. Play requires in-app reporting — built (the ⚑ button on every video) — plus published content rules. Write a one-paragraph "community rules" page if asked.
   - *Data safety form*: collects phone number (account management + payments), financial transaction history. Not shared with third parties, not sold.
   - *Financial features*: declare the wallet/payments honestly. Play may ask for proof of regulatory compliance in Rwanda — see the BNR licence section in README.md; the simulator-only pilot avoids this until you have real rails.
   - *Target audience*: 18+ keeps the financial declarations simplest.
5. Review typically takes a few days to two weeks for a first app.

Each new release later: bump `appVersionCode` in `twa-manifest.json`, `bubblewrap build`, upload the new `.aab`. UI changes don't need a release at all — the app loads your live site, so `fly deploy` updates every installed phone instantly. That's the quiet superpower of the TWA route.

## iOS — read this before paying Apple

Three hard truths, so you can plan:

1. **Tooling.** iOS apps can only be built on macOS (Xcode). No Mac → use a cloud build service (Codemagic, Ionic Appflow) or borrow one. Plus an Apple Developer account, $99/year.
2. **Wrapper rejection risk.** Apple guideline 4.2 rejects apps that are "just a website". The PWA must be wrapped with Capacitor and gain at least some native behaviour (push notifications, native share, offline handling) to pass review reliably.
3. **The 30% problem.** Apple treats tipping digital creators as a digital purchase, which must use Apple In-App Purchase (Apple keeps 15–30%, and IAP doesn't pay out in RWF to MoMo). This is the same fight TikTok and Patreon have had. Realistic options:
   - Physical goods (your escrow storefront) are exempt — those may use MoMo freely on iOS.
   - Tips on iOS either go through IAP at Apple's cut, or the tip button is hidden on iOS (creators still get paid from Android/web traffic).
   - The PWA itself stays fully functional in Safari on iPhone — installable from the share sheet, MoMo tips and all, with no Apple review at all. For Rwanda, where iPhone share is small, this is the sensible v1: **ship the PWA to iPhone users via the browser, ship the store app on Android.**

When you do want it: `npm i @capacitor/core @capacitor/cli`, `npx cap init Hobe rw.hobe.app`, point the webDir at a thin shell that loads your domain, `npx cap add ios`, build in Xcode/Codemagic. Budget a week including review round-trips.

## Checklist

- [ ] Fly.io account → `fly launch --copy-config --now` → app live at your URL
- [ ] `twa-manifest.json`: real domain in place of REPLACE.fly.dev
- [ ] `bubblewrap build` → keystore backed up → `.aab` produced
- [ ] Fingerprint into `public/.well-known/assetlinks.json` → `fly deploy`
- [ ] Test the `.apk` on your phone (no browser bar = asset links verified)
- [ ] Play Console: $25, listing assets, UGC + data safety + financial declarations
- [ ] Internal testing → Production
- [ ] iPhone users: point them at the website (Add to Home Screen) for now
