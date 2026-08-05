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

- **Dashboard:** https://dashboard.stripe.com (currently in **test mode** — no real money
  moves yet)
- **What's wired up:** checkout (`/api/stripe/checkout`), billing portal
  (`/api/stripe/portal`), and a webhook (`/api/stripe/webhook`) that listens for
  `checkout.session.completed`, `invoice.paid`, `customer.subscription.updated`, and
  `customer.subscription.deleted` to keep each user's plan/credits in sync.
- **Webhook endpoint:** registered directly via the Stripe API, pointed at
  `https://forgecut.app/api/stripe/webhook`. View/edit it under **Developers → Webhooks**
  in the Stripe dashboard.
- **To go live (start accepting real payments):**
  1. Complete Stripe's business verification (Dashboard → Activate account) — requires
     real business details, bank account.
  2. Switch the dashboard from Test to Live mode, create live-mode versions of the
     Creator/Business prices, and register a **new** live-mode webhook endpoint
     (test-mode and live-mode keys/webhooks are entirely separate).
  3. Replace `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_CREATOR`,
     `STRIPE_PRICE_BUSINESS` in `.env` with the live-mode values, redeploy.
- **Credentials:** `STRIPE_*` in `.env`. Rotating the secret key: Stripe dashboard →
  Developers → API keys → roll key.

---

## 9. Transactional email — Resend

- **Dashboard:** https://resend.com
- **What it's used for:** password reset emails only, right now
- **Plan:** Free tier — 3,000 emails/month
- **Sending domain:** currently using Resend's shared `resend.dev` address for the
  "from" — works with zero setup but looks less professional. To send from
  `noreply@forgecut.app` instead: Resend dashboard → **Domains** → Add `forgecut.app` →
  add the TXT/DKIM records it gives you to Porkbun's DNS → once verified, set
  `EMAIL_FROM=Clipforge <noreply@forgecut.app>` in `.env`.
- **Credentials:** `RESEND_API_KEY` in `.env`.

---

## 10. Source control — GitHub

- **Repo:** https://github.com/Anshumansh/clipforge (private)
- All deploys are `git pull` + `docker compose up -d --build` on the VPS — there's no CI
  pipeline yet. Pushing to `main` does **not** auto-deploy; you deploy manually via SSH
  (see §2).

---

## 11. Things that are NOT set up yet (known gaps)

- **Stripe live mode** — currently test mode only; no real payments possible. See §8.
- **Custom email domain** — password reset emails send from Resend's shared address, not
  `@forgecut.app`. See §9.
- **Error monitoring** (e.g. Sentry) — not configured. Errors are only visible via
  `docker logs clipforge-app-1` on the VPS.
- **Backups** — Neon (DB) and Backblaze B2 (storage) both have their own durability, but
  there's no separate automated backup/export process configured.
- **CI/CD** — deploys are manual (SSH in, `git pull`, rebuild). No automatic deploy on
  push to `main`.
- **Multi-instance scaling** — rate limiting and the render job queue are both in-memory
  in the single app container. This is fine for one server; if you ever run more than one
  app instance, both would need to move to something shared (e.g. Redis).

---

## 12. Cost summary (current, test-mode Stripe)

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
| Stripe | 2.9% + $0.30 per transaction, only once live mode is active |
