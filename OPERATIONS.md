# Clipforge — Operations Guide

Everything the business runs on: what each service does, why it's there, where its
credentials live, what it costs, and how to manage it. Read this when something breaks,
when you need to rotate a key, or when you're onboarding someone else to help run this.

Live site: **https://forgecut.app**
Source: **https://github.com/Anshumansh/clipforge**

---

## 1. How a request flows through the system

```
User's browser
     │  HTTPS (port 443)
     ▼
Caddy (reverse proxy, auto TLS)  ──┐  container: clipforge-caddy-1
     │  internal Docker network    │
     ▼                             │
Next.js app (port 3000)  ──────────┘  container: clipforge-app-1
     │
     ├─→ Neon Postgres        (accounts, projects, jobs, credits)
     ├─→ Backblaze B2         (rendered videos, uploaded source files)
     ├─→ OpenAI / Groq        (script writing, transcription, voice)
     ├─→ Microsoft Edge TTS   (free voiceover fallback)
     ├─→ Pexels               (stock b-roll footage)
     ├─→ Stripe                (checkout, subscriptions, billing portal)
     └─→ Resend                (password reset emails)
```

Both containers run on a single Hetzner VPS via Docker Compose
(`/opt/clipforge/docker-compose.yml`). Video rendering happens **inside** the app
container using a headless Chrome instance (Remotion) — this is the reason the VPS
needs real RAM (7.6GB), not a minimal box.

---

## 2. The VPS (server the whole thing runs on)

- **Provider:** Hetzner Cloud
- **Server:** `ubuntu-8gb-hel1-1`, IP `62.238.110.10`, 7.6GB RAM, Ubuntu, Docker
- **Dashboard:** https://console.hetzner.cloud
- **Cost:** ~€15-20/month (check the Hetzner console for the exact current rate)
- **Access:** SSH key only (password auth was disabled after initial setup)
  ```
  ssh -i ~/.ssh/clipforge_vps root@62.238.110.10
  ```
- **Firewall (ufw):** only ports 22 (SSH), 80 (HTTP→HTTPS redirect), 443 (HTTPS) are open.
  Check status: `ufw status verbose`
- **What's deployed where:** the repo lives at `/opt/clipforge` on the VPS, cloned from
  GitHub. Production secrets live in `/opt/clipforge/.env` (never committed to git).

**To deploy a code change:**
```bash
ssh -i ~/.ssh/clipforge_vps root@62.238.110.10
cd /opt/clipforge && git pull && docker compose up -d --build
```

**To check logs:**
```bash
docker logs clipforge-app-1 --tail 100     # app errors
docker logs clipforge-caddy-1 --tail 100   # proxy/TLS issues
```

**To edit environment variables:** edit `/opt/clipforge/.env` on the VPS directly, then
`docker compose up -d` to pick up the change (add `--force-recreate app` if only the
`.env` changed and the compose file didn't — Compose sometimes won't restart a
container for an env-only change).

---

## 3. Domain & DNS

- **Registrar:** Porkbun — https://porkbun.com
- **Domain:** `forgecut.app` (~$10-15/year, renews automatically unless cancelled)
- **DNS records:** two `A` records, both pointing at `62.238.110.10`
  - `@` (root) → `62.238.110.10`
  - `www` → `62.238.110.10` (Caddy redirects `www` → root domain)
- To change where the site points (e.g. moving to a new server), update these two `A`
  records in Porkbun's DNS panel. Changes usually propagate within minutes to a couple
  hours.

---

## 4. TLS / reverse proxy — Caddy

- Runs as a Docker container (`clipforge-caddy-1`), config at `/opt/clipforge/Caddyfile`
  (also in the git repo).
- Automatically obtains and renews free HTTPS certificates from Let's Encrypt — no
  manual renewal needed, ever.
- The app container has **no public port** — only Caddy is exposed to the internet
  (ports 80/443), and it proxies internally to the app on port 3000.
- If you change the Caddyfile, you must reload/recreate the container for it to take
  effect (a plain `docker compose up -d` sometimes won't detect a bind-mounted file
  change):
  ```bash
  docker compose up -d --force-recreate caddy
  ```

---

## 5. Database — Neon (Postgres)

- **Dashboard:** https://console.neon.tech
- **Plan:** Free tier
- **What it stores:** users, projects, jobs, credit balances, Stripe customer/subscription
  IDs, password reset tokens
- **Connection:** `DATABASE_URL` in `.env` (also used locally in dev)
- **Known quirk:** the free tier auto-suspends its compute after a few minutes of
  inactivity. The first request after idle time can take an extra second or two while it
  wakes back up. The app now retries transient connection errors automatically
  (`lib/db.ts`), so this shouldn't surface as an error to users — just a brief delay.
- **If you outgrow the free tier:** Neon's paid tiers remove the auto-suspend behavior
  and raise storage/compute limits. Upgrade from the Neon dashboard.
- **Schema changes:** edit `prisma/schema.prisma`, then run `npx prisma db push`
  (from a machine with `DATABASE_URL` pointed at production) to apply it live.

---

## 6. File storage — Backblaze B2

- **Dashboard:** https://secure.backblaze.com/b2_buckets.htm
- **Bucket:** `clipforge-media` (private — nothing is publicly listable)
- **What it stores:** rendered videos, generated voiceovers, uploaded source videos
  (for the Repurpose flow)
- **Plan:** Free tier — 10GB storage, 1GB/day free download
- **How files are served:** the app never exposes the bucket directly. A request for
  `/api/media/<key>` on the app generates a short-lived (1 hour) signed URL and redirects
  to it. This keeps the bucket private while still letting users download/stream their
  videos.
- **Why B2 and not Cloudflare R2:** R2's S3 API endpoint rejects TLS connections from
  this VPS's network entirely (confirmed with repeated `curl`/`openssl` tests — a known
  pattern of Cloudflare blocking hosting-provider IP ranges from reaching R2's API). B2
  works reliably from the same server.
- **Credentials:** `STORAGE_*` variables in `.env` (bucket, endpoint, region, key ID,
  application key). If a key is ever compromised, revoke it from the Backblaze dashboard
  under **Application Keys** and issue a new one.

---

## 7. AI providers

| Service | Used for | Dashboard | Notes |
|---|---|---|---|
| **OpenAI** | Script writing, Whisper transcription, TTS voiceover (primary) | https://platform.openai.com/usage | Billed per-use; check usage regularly early on |
| **Groq** | Same as OpenAI, used as the free fallback if OpenAI fails/isn't configured | https://console.groq.com | Free tier, fast inference |
| **Microsoft Edge TTS** | Voiceover fallback if both OpenAI and Groq fail | *(no account — unofficial free API)* | No dashboard/key; used automatically |
| **Pexels** | Stock video/photo b-roll matched to the script | https://www.pexels.com/api/ | Free API, rate-limited |

All of these are called with automatic fallback chains (see `lib/providers/`) — if the
primary provider fails or isn't configured, the app falls back to the next one rather
than failing the whole generation.

**API keys:** `OPENAI_API_KEY`, `GROQ_API_KEY`, `PEXELS_API_KEY` in `.env`. Rotate any of
these by generating a new key on the provider's dashboard and updating `.env` + redeploy.

---

## 8. Payments — Stripe

- **Dashboard:** https://dashboard.stripe.com — **live mode is active**; real payments
  are accepted.
- **Plans:** Free ($0, 50 credits) / Hobby ($19.99/mo, 300 credits) / Creator ($26.88/mo,
  600 credits) / Business ($44.99/mo, 2,500 credits). Defined in `lib/plans.ts`, with the
  Stripe price IDs in `.env`. Multi-format export (§ pricing page) is gated to Business
  via `lib/aspect-ratio.ts`'s `canUseAspectRatio`.
- **What's wired up:** checkout (`/api/stripe/checkout`), billing portal
  (`/api/stripe/portal`), and a webhook (`/api/stripe/webhook`) that listens for
  `checkout.session.completed`, `invoice.paid`, `customer.subscription.updated`, and
  `customer.subscription.deleted` to keep each user's plan/credits in sync.
- **Webhook endpoint:** registered directly via the Stripe API, pointed at
  `https://forgecut.app/api/stripe/webhook`. View/edit it under **Developers → Webhooks**
  in the Stripe dashboard.
- **Changing a price:** Stripe prices are immutable once created. Create a new Price
  object on the existing Product, archive the old one (`active=false`), update the
  matching `STRIPE_PRICE_*` env var, redeploy. See git history around 2026-08-07 for the
  exact API calls used to restructure pricing, including the two live-mode gotchas hit
  along the way: (1) a new-account default called "Managed Payments" requires every
  product to have a `tax_code` set, and (2) it requires a Stripe API version of
  `2025-03-31.basil` or later — this app is pinned to a newer one in `lib/stripe.ts`.
- **Credentials:** `STRIPE_*` in `.env`. Rotating the secret key: Stripe dashboard →
  Developers → API keys → roll key.
- **Past incident:** after restructuring from 2 tiers to the current Hobby/Creator/Business
  3-tier setup, `.env` on the VPS was never updated with the new price IDs — checkout
  silently 500'd for Creator and Business (both pointed at now-archived prices) until
  caught by a live test. If checkout ever breaks with a Stripe `resource_missing` error on
  `price`, check that every `STRIPE_PRICE_*` in `.env` actually points to an **active**
  price (`stripe prices retrieve <id>` or the dashboard) — not just that the var is set.

---

## 9. Transactional email — Resend

- **Dashboard:** https://resend.com
- **What it's used for:** password reset emails only, right now
- **Plan:** Free tier — 3,000 emails/month
- **Sending domain:** `forgecut.app` is verified with Resend (DKIM, SPF, and the
  `send` MX record are all set in Porkbun's DNS). Emails send from
  `Clipforge <noreply@forgecut.app>` — confirmed delivering to arbitrary recipients,
  not just the account owner's own address.
- **Credentials:** `RESEND_API_KEY` and `EMAIL_FROM` in `.env`.
- **If DNS ever needs to be recreated** (e.g. moving registrars): Resend dashboard →
  Domains → `forgecut.app` shows the exact DKIM/SPF/MX records to re-add.

---

## 10. Source control & deploys — GitHub Actions

- **Repo:** https://github.com/Anshumansh/clipforge (private)
- **Every push to `main` auto-deploys** via `.github/workflows/deploy.yml` — GitHub
  Actions SSHes into the VPS and runs `git reset --hard origin/main` +
  `docker compose up -d --build`. Check a deploy's status: `gh run list --limit 1`.
- Manual deploy still works as a fallback (see §2) if you ever need it.
- Secrets used by the workflow (`VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`) live in the repo's
  GitHub Actions secrets, not in this file.

---

## 11. Automated backups

- `scripts/backup-db.sh` dumps the production Postgres database (`pg_dump`, gzipped) and
  uploads it to the `clipforge-media` B2 bucket under `backups/`. Runs daily at 3am UTC
  via cron on the VPS; logs to `/var/log/clipforge-backup.log`.
- Retention: 30 days, pruned by the script itself (B2's own lifecycle-rule API rejected
  the standard config, so pruning is handled in-script instead of via a bucket rule).
- Media files (rendered videos) are not separately backed up — B2 itself is the durable
  store for those.
- To restore: download the relevant `backups/db-<timestamp>.sql.gz`, `gunzip`, and
  `psql "$DATABASE_URL" < backup.sql` against a fresh/target database.

---

## 12. Capacity & concurrency

- **Render queue** (`lib/jobs/queue.ts`): capped at **2 concurrent renders**. Measured in
  production — a single render peaks around **3.3GB RAM and ~360% CPU** (of 4 cores)
  because it runs a real headless-Chrome instance plus ffmpeg encoding. Two concurrent
  renders (~6.6GB) leaves enough headroom for the app/DB/Caddy on this VPS's 7.6GB; a
  third risked OOM. Requests beyond the cap wait in a FIFO queue and show their position
  ("Waiting in queue — N ahead of you") instead of failing or piling up.
- **Load tested**: 100 truly concurrent requests to the homepage all returned 200 with no
  degradation (latency was consistently ~1.7s from a distant test location — that's
  network RTT + TLS handshake to the VPS, not server processing time, which measured
  ~340ms). Also verified 4 concurrent generation requests correctly capped at 2 active
  renders with the other 2 queued and completing in order.
- **This is in-memory** — both the rate limiter and this render queue reset on deploy and
  only coordinate within one process. Fine for the current single-VPS setup; if you ever
  run more than one app instance, both need to move to something shared (e.g. Redis).
- **If you need real concurrent-render capacity beyond 2** (not just queueing safely):
  that requires horizontal scaling — either a second render worker/VPS or a serverless
  rendering service (e.g. Remotion Lambda) — which is a real infrastructure cost decision,
  not something to silently change.

---

## 13. Smart subject tracking (Repurpose)

Free and fully local — no paid API. Faces are detected via BlazeFace running on
TensorFlow.js's WASM backend (no native bindings, no GPU). One frame per second is
sampled from the source video (not every render frame) to build a smoothed horizontal
pan path; falls back to a plain center-crop if no face is found. Runs as a preprocessing
step before each clip renders — see `lib/providers/subject-tracking.ts`.

Two things worth knowing if this ever breaks:
- Remotion's bundled ffmpeg is a minimal build with **no network protocol support** (no
  openssl/gnutls) — it can only read local files. The source video is downloaded once per
  job (not once per clip) before analysis; if this step starts failing, check that the
  download (`prepareLocalSource`) still works against whatever storage backend is active.
- That same ffmpeg build also has no `fps` filter compiled in — frame sampling uses `-r`
  (output rate) instead of `-vf fps=...`.

---

## 14. Social auto-posting (YouTube / TikTok / Instagram)

Code-complete scaffolding — OAuth connect flow, encrypted token storage
(`ENCRYPTION_KEY`), per-platform publish logic, and a scheduling system (cron-triggered
every 5 minutes via `scripts/process-scheduled-posts.sh`, secured with `CRON_SECRET`).
Users connect accounts at **/dashboard/settings** and publish from any finished project.

**Not yet live** — each platform needs its own registered developer app, which only you
can create (needs your business/identity info, not something delegable):

- **YouTube**: Google Cloud Console → new project → enable "YouTube Data API v3" →
  OAuth consent screen → OAuth 2.0 Client ID (Web application) → add
  `https://forgecut.app/api/social/callback/youtube` as an authorized redirect URI. Set
  `YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET`.
- **TikTok**: [developers.tiktok.com](https://developers.tiktok.com) → create an app →
  add the "Content Posting API" product (this specific scope needs TikTok's review, unlike
  basic login) → redirect URI
  `https://forgecut.app/api/social/callback/tiktok`. Set `TIKTOK_CLIENT_KEY` /
  `TIKTOK_CLIENT_SECRET`.
- **Instagram**: via Meta for Developers → create an app → add "Instagram Graph API" →
  requires the Instagram account to be a Business/Creator account linked to a Facebook
  Page → redirect URI `https://forgecut.app/api/social/callback/instagram`. Set
  `META_APP_ID` / `META_APP_SECRET`.

Add whichever env vars you complete to `.env` and redeploy — each platform lights up
independently (the settings page shows "Not set up on this server yet" for any platform
missing its env vars, "Connect" once configured). None of the actual OAuth exchange or
publish calls have been tested live (no way to, without a registered app) — they're built
to each platform's current official docs, but treat the first real connection attempt per
platform as the real test.

---

## 15. Voice cloning (Business plan)

Self-hosted, free, no API account needed. Uses Coqui TTS's **YourTTS** model (open
source, zero-shot voice cloning from a single short reference clip) — chosen over
XTTS-v2 specifically because it's lighter and meaningfully faster on CPU-only inference,
which matters on a 4-vCPU box with no GPU.

**How it runs**: `voice-clone/clone.py` is a plain script — given a reference audio file,
target text, and an output path, it loads YourTTS and synthesizes speech in the reference
voice. `lib/providers/voice-clone.ts` invokes it as a **subprocess** (`execFile("python3",
[...])`, args passed as an array — never shell-interpolated, so arbitrary script text
can't be interpreted as shell syntax) from within `lib/jobs/script-runner.ts`, only when
the user uploaded a reference sample in the Script-to-Video wizard. Torch/torchaudio
(pinned to `2.1.0`/`2.1.0` — unpinned installs resolve mismatched ABI versions and crash
with `undefined symbol: aoti_torch_abi_version`), `TTS==0.22.0`, and the YourTTS model
weights are baked directly into the app's own Docker image (see `Dockerfile`), ordered
before the app source `COPY` so the layer is cached across deploys that don't touch it.

**Why a subprocess and not a separate container**: an earlier version ran this as its own
Docker image, invoked from the app container via `docker run --rm` against the VPS's
Docker socket. That needs the host socket bind-mounted into the app container — a real
container-escape exposure (anyone who gets RCE in the app gets root on the host) — plus
cross-container bind-mount path translation (paths in `-v` flags issued through a mounted
socket resolve against the *host* filesystem, not the calling container's, since the
daemon that resolves them is the host's). Baking the same recipe into the app image and
running it as a plain subprocess avoids both problems entirely, at the cost of a larger
image (~4-5GB heavier).

**Resource cost (measured directly, `docker stats` during a real inference run)**:
peak ~1.04GB RAM, up to ~300% CPU, ~1.3-6s actual synthesis time (real-time factor
0.2-1.0 depending on text length) plus ~15-20s model load — total wall time per request
is ~20-30s. This is well under a video render's ~3.3GB peak (§12). Because cloning only
ever runs *before* the render step within the same job (sequentially, not concurrently —
see `script-runner.ts`), and that job already occupies one of the `MAX_CONCURRENT_RENDERS
= 2` queue slots, the worst case across the whole VPS is still bounded by the existing
tested ceiling (2 concurrent heavy jobs) — no separate concurrency limit was needed for
this feature specifically.

**Gating & fallback**: gated to the Business plan (`canUseVoiceClone()` in `lib/plans.ts`)
given the resource cost per request. If cloning fails for any reason (bad sample, subprocess
timeout, transient error), `script-runner.ts` catches it and falls back to the normal Edge
TTS voiceover rather than failing the whole render.

**Verified**: real end-to-end inference on the VPS (reference clip → cloned output.wav,
audibly in the reference voice) and the resource measurement above. **Not yet verified**:
triggering it from the actual deployed app UI after this integration (upload a sample in
the Script-to-Video wizard, confirm the final rendered video uses the cloned voice), and
running it concurrently with an active video render under real load.

---

## 16. Cost summary (live Stripe since 2026-08-07)

| Item | Cost |
|---|---|
| Hetzner VPS | ~€15-20/month |
| Porkbun domain | ~$10-15/year |
| Neon Postgres | $0 (free tier) |
| Backblaze B2 | $0 (free tier, until >10GB or heavy egress) |
| Groq | $0 (free tier) |
| Pexels | $0 (free tier) |
| Resend | $0 (free tier, until >3,000 emails/month) |
| OpenAI | Pay-as-you-go — the only real variable cost; check usage regularly |
| Stripe | 2.9% + $0.30 per transaction (live mode active) |
