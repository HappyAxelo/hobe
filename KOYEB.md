# Deploying Hobe free on Koyeb + Cloudflare R2

Fly's trial expired, so this moves Hobe to a stack that stays free at pilot scale:

- **Koyeb** runs the app from the Dockerfile. The free instance has no sleep and needs no credit card.
- **Cloudflare R2** holds videos, avatars, and a continuous backup of the SQLite ledger. The free tier is 10 GB with zero egress fees.

The app falls back to local disk whenever the `R2_*` variables are unset, so nothing here changes how it runs on your laptop.

There are three stages: set up R2, deploy on Koyeb, then verify. Budget about 20 minutes.

---

## 1. Cloudflare R2

1. Sign up at <https://dash.cloudflare.com> (free, no card for R2's free tier).
2. In the dashboard, open **R2** in the sidebar and click **Create bucket**. Name it `hobe`. Leave the region on Automatic.
3. Note your **Account ID** — it's on the R2 overview page, and it's the `xxxx` in the S3 endpoint `https://xxxx.r2.cloudflarestorage.com`.
4. Create an API token: **R2 → Manage R2 API Tokens → Create API token**. Give it **Object Read & Write**, scoped to the `hobe` bucket. Copy the **Access Key ID** and **Secret Access Key** now — the secret is shown once.
5. Make the bucket's media publicly readable so phones stream video straight from R2 (this is what keeps bandwidth off the app server):
   - Open the bucket → **Settings → Public access → R2.dev subdomain → Allow Access**.
   - Copy the public URL it gives you, e.g. `https://pub-abc123.r2.dev`. That's your `R2_PUBLIC_BASE`.

   The ledger backup under `litestream/` stays private — only objects requested over the public URL are reachable, and nothing links to the backup path.

You now have five values: account ID, access key ID, secret access key, bucket name (`hobe`), and the public base URL.

---

## 2. Koyeb

1. Push this repo to GitHub if it isn't already.
2. Sign up at <https://app.koyeb.com> with your GitHub account (no card for the free instance).
3. **Create Web Service → GitHub →** pick the Hobe repo.
4. Builder: choose **Dockerfile** (Koyeb detects it automatically).
5. Instance: pick the **Free** instance type.
6. Port: set the exposed port to **3000**.
7. Add environment variables (mark the secret ones as *Secret*, not plaintext):

   | Variable | Value |
   |---|---|
   | `R2_ACCOUNT_ID` | your account ID |
   | `R2_ACCESS_KEY_ID` | access key ID |
   | `R2_SECRET_ACCESS_KEY` | secret access key (Secret) |
   | `R2_BUCKET` | `hobe` |
   | `R2_PUBLIC_BASE` | your `https://pub-….r2.dev` URL |
   | `MOMO_PROVIDER` | `simulator` (switch to `mtn` when ready) |

8. Deploy. The first build takes a few minutes (it pulls ffmpeg and the Litestream binary).

On first boot the entrypoint finds no backup, seeds the demo data, uploads the demo clips to R2, and starts streaming the ledger to R2. Every later deploy restores the ledger from R2 first, so tips, balances, and uploads survive.

---

## 3. Verify

- Open the Koyeb service URL. The feed should load and demo videos should play (they're streaming from `R2_PUBLIC_BASE`).
- Sign up, upload a short clip, and confirm it plays back. In the Cloudflare dashboard the bucket should now show `videos/…` and `avatars/…` objects, plus a `litestream/` folder.
- Trigger a redeploy on Koyeb. After it restarts, your earlier signup and uploads should still be there — that confirms the Litestream restore worked.

If video doesn't play, the usual cause is the bucket not being public: re-check step 1.5 and that `R2_PUBLIC_BASE` matches the r2.dev URL exactly (no trailing slash).

---

## Updating the TWA / Play Store build

The Android wrapper points at the old Fly URL. Once Koyeb is live:

- Update the host in `twa-manifest.json` and `public/manifest.webmanifest` to the Koyeb URL (or a custom domain).
- Update `assetlinks.json` to be served from the new origin.

A custom domain on Cloudflare (free DNS) in front of both Koyeb and R2 avoids re-pointing the TWA again later.

---

## Costs and limits

At pilot scale this is genuinely free. Watch two numbers in the Cloudflare dashboard:

- **R2 storage** — free up to 10 GB. At ~3.5 MB per 60-second clip that's roughly 2,800 clips. Beyond 10 GB it's about $0.015/GB-month ($15 for 1 TB), still with no egress charge.
- **R2 Class A operations** (uploads) — 1 million/month free, far above pilot upload volume.

When you outgrow the free tier, nothing in the code changes — you just start paying R2's per-GB rate, or point a CDN at the bucket.
