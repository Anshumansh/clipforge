# Clipforge Full Codebase Audit
**Date:** 2026-08-11  
**Auditor:** octo-agent (read-only, no files modified)  
**Codebase:** `C:\Users\sharm\Downloads\claude revid` → https://github.com/Anshumansh/clipforge  
**Live site:** https://forgecut.app  

---

## A. Executive Summary

Clipforge is a Next.js 14 SaaS product that generates short-form vertical videos from text scripts, repurposes long-form uploads into clips, and creates UGC-style ads. It uses OpenAI (GPT-4o-mini + Whisper + TTS-1) with Groq and Microsoft Edge TTS as fallbacks, Remotion for video rendering, Backblaze B2 for storage, Stripe for live payments, and runs on a single Hetzner VPS via Docker Compose.

**Overall health:** The codebase is well-structured and clearly maintained by a thoughtful developer. Four documented remediation passes have addressed past security issues. However, several critical production risks remain.

**The five most urgent issues:**

1. **P0 — Credits lost on server restart:** `reconcileOrphanedJobs()` marks in-flight jobs as failed on every deploy but **never refunds credits**. Every deploy silently steals credits from users whose renders were in progress.

2. **P0 — Admin account has no MFA:** TOTP two-factor authentication is built, tested, and deployed — but the real admin account hasn't enrolled. The sole admin account is password-only.

3. **P0 — Known Next.js vulnerability (GHSA-955p-x3mx-jcvp):** Next.js 14.2.15 has a confirmed advisory for unauthenticated disclosure of internal Server Function endpoints. Fix requires a major version upgrade (Next 15/16).

4. **P1 — Plan gates missing on repurpose and UGC routes:** Free and Hobby plan users with credits can submit repurpose and UGC jobs — neither route checks whether the user's plan permits those workflows. They are creator-tier features that are completely unenforced in production.

5. **P1 — Rendering runs in the web process:** Remotion + headless Chrome runs inside the Next.js API process. A render OOM can kill the web server, authentication, and billing simultaneously. One incident of this has already occurred (documented in OPERATIONS.md).

**Risk level:** MEDIUM-HIGH. Live Stripe payments are active. The credit refund bug is a direct financial issue affecting all users on every deploy.

---

## B. Architecture Map

```
Internet
  │  HTTPS 443
  ▼
Caddy (reverse proxy, auto-TLS)        ← Hetzner VPS, 7.6GB RAM
  │  internal Docker network (port 3000)
  ▼
Next.js 14.2.15 (App Router, standalone output)
  │
  ├── Frontend (React 18, Tailwind, Radix UI, Framer Motion)
  │     Pages: /login /register /dashboard /pricing /roadmap /changelog /admin
  │     Client: no client-side fetch to external APIs — all via /api/*
  │
  ├── Backend (Next.js API routes, App Router, Node.js runtime)
  │     Auth:      /api/auth/[...nextauth] → next-auth v4, JWT strategy, credentials only
  │     Payments:  /api/stripe/{checkout,portal,webhook}
  │     Generate:  /api/projects/{script,repurpose,ugc}
  │     Media:     /api/media/[...key] → unauthenticated, prefix-guarded presigned redirect
  │     Admin:     /api/admin/* → isAdmin DB lookup guard (fresh per request, not JWT)
  │     Social:    /api/social/* → OAuth scaffolded, not live (no platform credentials)
  │     Trend:     /api/trend/* → YouTube Data API v3
  │     Demo:      /api/demo/generate → anonymous, IP-rate-limited
  │     Health:    /api/health → public uptime check
  │
  ├── Job Queue (in-memory, single process!)
  │     lib/jobs/queue.ts — 2 concurrent render cap, FIFO pending queue
  │     lib/jobs/script-runner.ts, repurpose-runner.ts, ugc-runner.ts
  │     Worker is NOT a separate process — runs inside Next.js
  │
  ├── Video Pipeline
  │     1. generateScript()    → GPT-4o-mini / llama-3.3-70b / mockScript()
  │     2. pickBrollScenes()   → Pexels video/image API (sequential, 1 per keyword)
  │     3. synthesizeVoiceover()→ OpenAI TTS-1 → Microsoft Edge TTS → mockVoiceover()
  │     4. cloneVoice()        → Coqui YourTTS Python subprocess (Business plan only)
  │     5. renderScriptVideo() → Remotion (headless Chrome + ffmpeg, ~3.3GB RAM peak)
  │     6. uploadLocalFile()   → Backblaze B2 (S3-compatible)
  │
  ├── Database: Neon Postgres (free tier, cold-start retry in lib/db.ts)
  │     ORM: Prisma 5.20, schema-managed via `prisma db push` (no migration files)
  │
  ├── Auth: next-auth v4, JWT sessions
  │     Provider: credentials (email + bcrypt password)
  │     MFA: TOTP admin-only (built, deployed, NOT YET ENROLLED)
  │     Social: SocialAccount model exists, OAuth scaffolded, no live platforms
  │
  ├── Storage: Backblaze B2 (`clipforge-media` bucket, private)
  │     Access: /api/media/* → 307 to 1-hour presigned URL
  │     Backup: same bucket under `backups/` prefix, same credentials (risk!)
  │
  ├── Payments: Stripe (LIVE MODE — real payments accepted)
  │     Plans: Free / Hobby ($19.99) / Creator ($26.88) / Business ($44.99)
  │     New plans (Starter/Pro) exist in Stripe TEST mode only, not deployed
  │     Webhooks: checkout.session.completed, invoice.paid/failed, subscription.updated/deleted, dispute, customer.deleted
  │     Dedup: StripeWebhookEvent table (deployed, production)
  │
  ├── AI Providers
  │     LLM:           OpenAI GPT-4o-mini → Groq llama-3.3-70b → mockScript()
  │     Transcription: OpenAI Whisper-1 → Groq whisper-large-v3 → null
  │     TTS:           OpenAI tts-1 → Microsoft Edge TTS → mockVoiceover()
  │     B-roll:        Pexels video/image API → gradient fallback
  │     Pattern:       Groq only (chatJSONFree — never uses paid OpenAI)
  │
  ├── Email: Resend (password reset + verification + workspace invites)
  │     Currently: password reset only confirmed working
  │     support@forgecut.app: needs Porkbun forwarding (may bounce today)
  │
  ├── Analytics: NONE (no tracking, no analytics script)
  │
  ├── Admin: /admin page, isAdmin boolean flag (set directly in DB)
  │     Features: user search, credit grants, plan comps, MFA setup, Stripe reconciliation
  │     Audit log: AdminAction model (verified working)
  │
  └── Deployment
        GitHub Actions → SSH → git reset --hard → docker compose up -d --build
        CI gate: typecheck + next build + npm test (20 unit tests)
        No staging environment. All deploys go directly to production.
```

**Credit system (dual, in transition):**
- **Legacy (live):** `lib/credits.ts` — atomic `updateMany` charge, direct `update` refund, no ledger
- **New (behind `PRICING_V2_ENABLED=true` flag, not yet live):** `lib/pricing/ledger.ts` — full reserve/capture/release lifecycle with `CreditLedgerEntry` and `CreditReservation` tables

**New pricing overhaul (test mode only):**  
Starter ($15) / Creator ($29) / Pro ($59) / Business ($119) plans with credit packs and annual billing exist in Stripe test mode. Checkout, webhooks, and plan enforcement for these plans are not yet wired. `PRICING_V2_ENABLED` is `false` in production.

---

## C. Full Issue List

### P0 — Critical / Money / Security

---

**[BUG-001] [P0] Credits permanently lost on every deploy**
- Area: Reliability / Payments
- File: `lib/jobs/queue.ts:30-46`
- Problem: `reconcileOrphanedJobs()` marks all `queued` or `processing` jobs as `failed` on server startup (to handle the in-memory queue reset), but **never calls `refundCredits()`**. Any user whose render was in flight during a deploy has their credits silently deleted.
- Impact: Every deploy steals 10 credits per in-progress render. With 3.3GB peak RAM per render and 2 concurrent slots, up to 20 credits are lost per restart. Happens on every production deploy.
- Fix: After `db.job.updateMany({ status: "failed" })`, iterate the orphaned jobs and call `refundCredits(project.userId, CREDITS_PER_VIDEO)` for each. Must use `resolveProjectCreditOwnerId` to handle workspace projects correctly.
- Test: Deploy while a render is active; verify the user's credit balance after restart.
- Risk: Low. Refund is purely additive. Edge case: workspace membership could change between charge and refund — use the project's stored `workspaceId`, same pattern as the job runners.

---

**[SEC-001] [P0] Admin account has no MFA enrolled**
- Area: Security / Auth
- File: `REMEDIATION_STATUS.md`, `lib/mfa.ts`, `lib/auth.ts`
- Problem: TOTP two-factor auth is built, tested, and deployed (Pass 3), but the real admin account at `sharma0810anshuman@gmail.com` has never completed enrollment. The sole admin account is protected by password only.
- Impact: A compromised admin password gives full access to credit grants, plan comps, user data, and the Stripe reconciliation report with no second factor.
- Fix: Log into `/admin` with the real account, scan the QR code, save the 8 backup codes somewhere safe (password manager). This is an owner action, not a code change.
- Test: Log out, log in with correct TOTP code; verify wrong code rejects; verify backup code works and is consumed.
- Risk: Zero code risk. This is a manual enrollment step.

---

**[SEC-002] [P0] Known Next.js vulnerability (GHSA-955p-x3mx-jcvp)**
- Area: Security / Deployment
- File: `package.json:43` — `"next": "14.2.15"`
- Problem: Next.js 14.2.15 has a confirmed CVE for unauthenticated disclosure of internal Server Function endpoints. Also has vulnerable transitive `postcss`. Confirmed by `npm audit` (documented in REMEDIATION_STATUS.md CF-013).
- Impact: An attacker may be able to call internal Server Actions endpoints without authentication. This is a published, searchable vulnerability.
- Fix: Upgrade to Next.js 15 or 16. This is a breaking major-version change requiring a dedicated regression pass.
- Test: Run `npm audit` post-upgrade. Test every page renders and every API route works.
- Risk: HIGH. Major version upgrade. Do not rush. Schedule as a dedicated sprint.
- Dependencies: Plan time for App Router compatibility testing.

---

**[BUG-002] [P0] mockVoiceover returns null audioUrl — video renders with no audio**
- Area: Video Pipeline / Reliability
- File: `lib/providers/tts.ts:44-53`, `lib/jobs/script-runner.ts:58`
- Problem: When both OpenAI TTS and Microsoft Edge TTS fail, `synthesizeVoiceover()` returns `mockVoiceover()` which has `audioUrl: null`. The script runner proceeds to `renderScriptVideo()` with `audioUrl: null`. The Remotion composition renders a video with no audio. The user gets a broken video with no error shown.
- Impact: Silent quality degradation. User pays 10 credits for a soundless video.
- Fix: In `synthesizeVoiceover()`, throw an error if Edge TTS also fails (don't fall back to mock for production jobs). Or: check `voiceover.mocked === true` in the runner and throw before rendering.
- Test: Disable both OPENAI_API_KEY and mock Edge TTS to fail; verify job fails with an error message and credits are refunded.
- Risk: Low. Currently the mock path silently produces a broken video — failing loudly is better.

---

### P1 — Serious Production Issues

---

**[BUG-003] [P1] Repurpose and UGC routes have no plan eligibility check**
- Area: Bugs / Payments
- File: `app/api/projects/repurpose/route.ts`, `app/api/projects/ugc/route.ts`
- Problem: Neither route checks whether the user's plan allows repurpose or UGC workflows. `lib/plans.ts` has no `canUseRepurpose()` or `canUseUgc()` function. The new `PLAN_CONFIGS` (in `lib/pricing/plan-config.ts`) restricts repurpose to Creator+ and UGC to Creator+, but this is behind `PRICING_V2_ENABLED=false`. In production, a free or hobby user with 10+ credits can submit repurpose and UGC jobs.
- Impact: Revenue leakage. Free users access $26.88/mo features for free by burning their 50 signup credits.
- Fix: Add `canUseRepurpose(plan)` and `canUseUgc(plan)` to `lib/plans.ts`. Add the check in both API routes after `resolveGenerationContext()`. Also gate the wizard UIs.
- Test: Log in as a free user, attempt to POST to `/api/projects/repurpose`; expect 403.
- Risk: Low. Adding a guard. Existing users who discover this workaround will lose access — communicate if needed.
- Dependencies: Decide which plans get repurpose access in the legacy plan system before shipping.

---

**[BUG-004] [P1] Credit charge not atomic with project+job creation**
- Area: Bugs / Payments
- File: `app/api/projects/script/route.ts:79-120`, `app/api/projects/repurpose/route.ts:63-95`
- Problem: The flow is: (1) `chargeCredits()` → (2) `project.create()` → (3) `project.update()` → (4) `job.create()` → (5) `enqueueJob()`. If the server crashes between steps 1 and 4, credits are deducted but no project or job exists. The new `lib/pricing/ledger.ts` `reserveCredits()` solves this (it's transactional) but is not yet wired into the routes.
- Impact: Credits lost with no project if server crashes mid-request. Low probability per request, but real over time.
- Fix: Wire `reserveCredits()` from `lib/pricing/ledger.ts` into the generation routes (even before the full pricing v2 flag is enabled), wrapped in a `try/finally` that calls `releaseReservation()` on failure.
- Test: Simulate crash between charge and job creation; verify credits are restored on next startup.
- Risk: Medium. Requires adding a CreditReservation row per generation. The `reserveCredits()` function is already written and tested.
- Dependencies: `PRICING_V2_ENABLED` is NOT required for this — the reservation system is independently useful.

---

**[SEC-003] [P1] Rendering runs inside the web process**
- Area: Security / Reliability
- File: `lib/jobs/queue.ts`, `lib/remotion-render.ts`, `docker-compose.yml`
- Problem: Remotion (headless Chrome + ffmpeg) runs in the same Node.js process as the Next.js web server. A render OOM can kill authentication, billing, and the entire web app simultaneously. One OOM-kill has already occurred in production (OPERATIONS.md §12 incident, 2026-08-08).
- Impact: Complete site outage during renders. Login, payments, and dashboard all unreachable.
- Fix: Separate the worker into its own container or process. Options: (a) `docker-compose` sidecar worker process that polls DB for queued jobs, (b) Remotion Lambda for cloud rendering, (c) BullMQ + Redis for durable queue + isolated worker.
- Test: Run 2 concurrent renders while hammering the homepage; verify no 500s.
- Risk: HIGH. This is a significant architectural change. Plan as a dedicated sprint.
- Dependencies: Would eliminate BUG-001 (orphan reconciliation) if durable queue is used.

---

**[SEC-004] [P1] Backup files in the same bucket and credentials as user media**
- Area: Security
- File: `scripts/backup-db.sh`, `lib/storage.ts`, `OPERATIONS.md §6`
- Problem: Database backups go to `s3://clipforge-media/backups/` using the same `STORAGE_ACCESS_KEY_ID`/`STORAGE_SECRET_ACCESS_KEY` as live media serving. Any leaked media credential also leaks full DB backups (emails, password hashes, Stripe IDs, encrypted OAuth tokens).
- Impact: A single credential leak exposes everything — customer PII, password hashes, payment data.
- Fix: Create a second Backblaze B2 application key scoped to a separate `clipforge-backups` bucket with read/write/delete restricted to that bucket only. Update `backup-db.sh` to use the new credential. This is an owner action in the Backblaze console; the code update is trivial once the credential exists.
- Test: Verify the media credential cannot access the backups bucket (403). Verify a successful backup round-trip with the new credential.
- Risk: Low code risk. Requires owner action in Backblaze console.

---

**[SEC-005] [P1] `X-Forwarded-For` trusted without validation — rate limits bypassable**
- Area: Security
- File: `lib/rate-limit.ts:45-51`, `app/api/register/route.ts:22`, `app/api/demo/generate/route.ts:21`
- Problem: `getClientIp()` reads `X-Forwarded-For` from the request header without verifying Caddy actually set it. An attacker bypassing Caddy (e.g., direct VPS access on port 3000, or a spoofed header) can set arbitrary `X-Forwarded-For` values to bypass IP-based rate limits on registration and demo generation.
- Impact: Unlimited demo generations, unlimited registrations, unlimited credit farming on free signups.
- Fix: In Caddy, configure `trusted_proxies` and set `X-Real-IP` from Caddy itself (not client-supplied). In `getClientIp()`, trust only headers set by the reverse proxy. The VPS firewall (ufw) already blocks direct access to port 3000 from the internet — document this dependency explicitly.
- Test: Send a request to port 3000 directly from the VPS with a spoofed `X-Forwarded-For`; verify it hits the real limit, not the spoofed IP's.
- Risk: Low. Header trust restriction. No API changes.

---

**[PAY-001] [P1] Plan upgrade via Stripe portal doesn't credit the new plan's balance**
- Area: Payments
- File: `app/api/stripe/webhook/route.ts:146-163`
- Problem: `customer.subscription.updated` updates `User.plan` and `stripePriceId` but does NOT update `User.credits`. A user who upgrades from Hobby (300 credits) to Business (2500 credits) mid-month via the billing portal gets the new plan's features immediately, but doesn't receive Business-level credits until the next billing cycle's `invoice.paid`.
- Impact: Upgraded users feel cheated — they pay the higher price but get no additional credits until renewal.
- Fix: In the `customer.subscription.updated` handler, if the new plan has more credits than the user's current balance AND the old plan had fewer, top up to the new plan's `monthlyCredits`. Or: pro-rate the credit difference. Decision needed on policy.
- Test: Upgrade a test account mid-month; verify credit count increases to new plan level.
- Risk: Medium. Depends on policy decision. Wrong implementation could over-grant credits.

---

**[AUTH-001] [P1] No session invalidation on password change**
- Area: Auth
- File: `app/api/auth/reset-password/route.ts`, `lib/auth.ts`
- Problem: JWT sessions remain valid after password reset or account compromise. If an attacker has an active session (stolen cookie), the account owner cannot invalidate it by changing their password.
- Impact: An attacker with a stolen session maintains access even after the victim resets their password.
- Fix: On password reset, generate a new `passwordHash` that includes a rotating session version in the JWT callback. Or: migrate to database sessions (`strategy: "database"`) which can be invalidated server-side.
- Test: Get a valid session cookie, change the password, retry the original cookie — it should 401.
- Risk: Medium. Migrating from JWT to DB sessions is a non-trivial change.

---

**[AUTH-002] [P1] Concurrent registration race on same email returns 500**
- Area: Auth / Bugs
- File: `app/api/register/route.ts:36-43`
- Problem: Two simultaneous registrations with the same email both pass the `findUnique` existence check, then the second `db.user.create()` throws a Prisma `P2002` unique constraint error — which is NOT caught, so it returns an unhandled 500 instead of a friendly 409.
- Impact: Concurrent registrations (e.g., double-click submit) return 500 instead of a helpful duplicate-email message.
- Fix: Wrap `db.user.create()` in try/catch; catch `PrismaClientKnownRequestError` code `P2002` and return 409.
- Test: Send two simultaneous POST requests to `/api/register` with the same email; both should return 200 or 409, never 500.
- Risk: Very low. Pure error handling addition.

---

**[VID-001] [P1] Source video (up to 300MB) buffered entirely in memory**
- Area: Bugs / Performance
- File: `app/api/projects/repurpose/route.ts:83`
- Problem: `const buffer = Buffer.from(await file.arrayBuffer())` reads the entire uploaded video into Node.js heap memory before uploading to B2. A 300MB video holds 300MB of heap for the duration of the upload, during which Remotion may also be running.
- Impact: Can trigger OOM during concurrent repurpose uploads + renders. 300MB + 3.3GB render = potential OOM on the 7.6GB VPS.
- Fix: Stream the upload directly to B2 using the `S3Client`'s multipart upload or `PutObjectCommand` with a `ReadableStream` body, without buffering the entire file.
- Test: Upload a 300MB video while a render is active; verify no OOM crash.
- Risk: Medium. Requires streaming multipart upload implementation.

---

**[REL-001] [P1] Credit refund failure is silently dropped**
- Area: Reliability / Payments
- File: `lib/jobs/script-runner.ts:103-105`, `lib/jobs/repurpose-runner.ts:173-175`
- Problem: `refundCredits(...).catch(e => console.error(...))` — if the DB is unavailable when a refund fires after a job failure, the refund is lost forever. No retry, no pending-refund record.
- Impact: Users lose credits on job failure AND lose the refund if the DB is temporarily down (e.g., Neon cold-start at the exact moment of failure).
- Fix: Either retry the refund with exponential backoff, or create a `PendingRefund` record that a background job processes. At minimum, use `CreditReservation.releaseReservation()` from the new ledger system which is idempotent.
- Test: Simulate DB unavailability during job failure; verify the credit eventually comes back.
- Risk: Low to medium depending on approach.

---

**[DEPLOY-001] [P1] No staging environment**
- Area: Deployment
- File: `.github/workflows/deploy.yml`
- Problem: Every push to `main` deploys directly to production. The CI gate runs typecheck + build + 20 unit tests but no integration test against a real database. A bug in the generation flow (Remotion, Stripe webhook, credit logic) can only be caught in production.
- Impact: Breaking changes go live immediately. No ability to test risky changes (major Next.js upgrade, pricing system cutover) safely.
- Fix: Add a staging environment (second Hetzner VPS, or Railway with a separate `.env`). Gate deploy to staging on `main`, deploy to production only on tagged releases or manual approval.
- Risk: Infrastructure cost and setup time.

---

**[TEST-001] [P1] No tests for core video generation flows**
- Area: Testing
- File: `lib/jobs/script-runner.ts`, `lib/jobs/repurpose-runner.ts`, `lib/jobs/ugc-runner.ts`
- Problem: The most business-critical code paths (credit charge, video generation, fallback chains, refund-on-failure) have zero automated tests. The 20 existing tests cover credits, workspace billing, MFA logic, and Stripe webhook handling — nothing covers the runner pipeline.
- Impact: A refactoring or dependency update can break video generation entirely with no automated signal.
- Fix: Add unit tests (with mocked providers) for: (a) script-runner happy path, (b) script-runner failure → credit refund, (c) voice clone fallback to TTS, (d) partial repurpose clip failure (some clips fail, project still succeeds).
- Test: Run `npm test` after writing tests.
- Risk: None. Tests only add coverage.

---

### P2 — Important Improvements

---

**[SEC-006] [P2] CSP allows `'unsafe-inline'` for scripts**
- Area: Security
- File: `next.config.js:26`
- Problem: `script-src 'self' 'unsafe-inline'` weakens XSS protection. An injected script tag would execute.
- Impact: XSS via a stored or reflected injection would have full JS execution capability.
- Fix: Migrate to nonce-based CSP by threading a per-request nonce through Next.js middleware. Complex but significantly more secure.
- Test: Check CSP header; verify no `'unsafe-inline'` in script-src.
- Risk: High complexity. Next.js App Router makes nonce-based CSP non-trivial.

---

**[SEC-007] [P2] `next.config.js` images allows ANY hostname**
- Area: Security
- File: `next.config.js:52-54`
- Problem: `images: { remotePatterns: [{ protocol: "https", hostname: "**" }] }` allows the Next.js image optimizer to proxy any HTTPS URL. This could be abused for SSRF via the image optimization endpoint.
- Impact: Low-severity SSRF risk. An attacker crafting a URL with an internal hostname could probe the VPS network through the image proxy.
- Fix: Restrict to specific hostnames: `i.ytimg.com` (YouTube thumbnails) and `s3.us-west-004.backblazeb2.com` (Backblaze). No other external image hostnames are used.
- Test: Attempt to load an image via `/_next/image?url=https://169.254.169.254/...`; verify it's blocked.
- Risk: Low. Restrictive change; will break any external images not explicitly allowed.

---

**[BUG-005] [P2] B-roll scenes fetched sequentially, not in parallel**
- Area: Performance / Bugs
- File: `lib/providers/broll.ts:84-107`
- Problem: `pickBrollScenes()` uses a `for` loop — each of 4-6 Pexels API calls waits for the previous one. With 15s timeout each, worst case is 90s just for b-roll if Pexels is slow.
- Impact: Slow video generation. Each parallel call is independent.
- Fix: `return Promise.all(list.map(async (keyword, i) => { ... }))`.
- Test: Time `pickBrollScenes()` before and after with 6 keywords.
- Risk: None. These calls are fully independent.

---

**[PAY-002] [P2] No credit ledger in production — no audit trail**
- Area: Payments / Database
- File: `lib/credits.ts`, `lib/pricing/ledger.ts`
- Problem: `lib/credits.ts`'s `chargeCredits()` and `refundCredits()` do NOT write to `CreditLedgerEntry`. The ledger system in `lib/pricing/ledger.ts` is behind `PRICING_V2_ENABLED=false`. In production, `User.credits` is a single mutable integer with no event history. "Why does this account have 40 credits?" is unanswerable.
- Impact: No audit trail for credits. Customer disputes cannot be investigated. Admin grants aren't reflected in the ledger.
- Fix: Enable ledger writes in the legacy credit functions (independent of pricing v2). Even a minimal `type: "charge"` / `type: "refund"` entry on every credit write would provide the audit trail.
- Test: Charge and refund credits; verify `CreditLedgerEntry` rows exist.
- Risk: Low. Additive DB writes. Add idempotency keys to prevent double-writes.

---

**[PAY-003] [P2] Stripe reconciliation doesn't cover new v2 plan price IDs**
- Area: Payments
- File: `lib/stripe-reconciliation.ts`
- Problem: The reconciliation report (`/api/admin/reconciliation`) only knows legacy plan price IDs. When new v2 plan subscribers arrive, the reconciler will flag them all as mismatched.
- Impact: When pricing v2 is enabled, the reconciliation report becomes useless (all false positives).
- Fix: Update the reconciler to know both legacy and v2 price ID mappings.
- Risk: Low. Read-only report. Fix before enabling `PRICING_V2_ENABLED=true`.

---

**[DB-001] [P2] `prisma db push` in production — no migration history**
- Area: Database / Deployment
- File: `OPERATIONS.md §5`, `prisma/schema.prisma`
- Problem: Schema changes are applied with `prisma db push` which inspects the current state and attempts to migrate directly. There are no `prisma/migrations/` files, so there's no way to: (a) know what changed between deploys, (b) roll back a bad schema change, (c) apply changes safely in order.
- Impact: A schema change that drops a column or changes a type could silently fail or cause partial data loss in production.
- Fix: Switch to `prisma migrate dev` for schema changes. Generate migration files and commit them. Use `prisma migrate deploy` in production CI. This requires running on a database that supports migration tracking.
- Test: Apply a schema change through the migration workflow end-to-end.
- Risk: Medium. Migration workflow change. Do on a non-critical schema change first.

---

**[DB-002] [P2] Missing indexes on frequently queried fields**
- Area: Database / Performance
- File: `prisma/schema.prisma`
- Problem: Several fields used in regular queries have no index:
  - `Job.status` — used in `reconcileOrphanedJobs()` and job polling
  - `Job.userId + status` — no composite index for "user's active jobs"
  - `Project.userId + status` — no composite index for dashboard project list
  - `User.plan` — used in plan-gate checks (though rare for index to help here)
- Impact: Slow queries as user/job count grows.
- Fix: Add `@@index([status])` on Job, `@@index([userId, status])` on Job and Project.
- Test: `EXPLAIN ANALYZE` on the dashboard project list query.
- Risk: Low. Index additions are safe. Minimal downtime for index builds on small tables.

---

**[UX-001] [P2] "Videos generated" counter includes test/admin renders**
- Area: UX / Legal
- File: `app/page.tsx:304`
- Problem: The homepage stat `<StatCounter value={videosGenerated} />` counts ALL `Project.status = 'ready'` rows, including every test render made during development. Per REMEDIATION_STATUS.md: "it isn't a 'customers generated N videos' metric even though it can read as one."
- Impact: Misleading social proof metric. Not fabricated (real renders), but includes non-customer renders.
- Fix: Add a `Project.isDemo Boolean @default(false)` flag. Exclude demo projects and admin-attributed projects from the count. Or accept the limitation and add a disclaimer ("including test renders").
- Test: Count real customer projects only; display that number.
- Risk: Low. Schema addition + query update.

---

**[UX-002] [P2] support@forgecut.app likely bouncing today**
- Area: UX / Operations
- File: `OPERATIONS.md §9`
- Problem: All customer-facing contact, legal, and support emails route to `support@forgecut.app`. Porkbun email forwarding must be configured for this address to actually deliver. Per OPERATIONS.md, this was not confirmed as set up.
- Impact: Every customer support email, DMCA notice, and privacy request silently bounces.
- Fix: Log into Porkbun → Domain → Email Forwarding. Add `support@forgecut.app` → your real inbox. Test by sending a test email.
- Test: Send an email to `support@forgecut.app` from an external address; confirm it arrives.
- Risk: Zero. DNS configuration only.

---

**[COST-001] [P2] No per-video cost tracking**
- Area: AI/Cost
- File: `lib/jobs/script-runner.ts`, `lib/jobs/repurpose-runner.ts`
- Problem: `JobCostRecord` table exists in schema with full cost tracking (AI tokens, TTS chars, render seconds, storage bytes) but is NEVER populated by any job runner. Per PRICING_OVERHAUL_BRIEF.md section 6 and REMEDIATION_STATUS.md (CF-021): unit economics are completely unknown.
- Impact: Cannot determine if any plan is profitable. The Business plan at $44.99/mo (legacy) or $119/mo (new) for 2,500/3,500 credits may be losing money at full usage.
- Fix: After each pipeline step in the runners, create/update a `JobCostRecord` row with the provider, model, token counts, and duration. Use nullable fields for costs that can't be measured (mark as "requires verification").
- Test: Generate a video; verify a `JobCostRecord` row exists with populated fields.
- Risk: Low. Additive writes only.

---

**[COST-002] [P2] LLM fallback to mockScript() is silent**
- Area: AI/Cost / UX
- File: `lib/providers/script.ts:181`, `lib/jobs/script-runner.ts:44`
- Problem: If both OpenAI and Groq fail, `generateScript()` returns `mockScript()` — a generic 5-sentence template. The user gets a watermarked, low-quality script with no indication that AI generation failed. They still pay 10 credits.
- Impact: Users pay for AI-generated content, receive a template, and have no way to know the difference unless they're familiar with the mock output.
- Fix: In the script runner, check `scriptResult.mocked === true` (add a `mocked` flag to `ScriptResult`). If mocked, either: (a) fail the job and refund, or (b) warn the user in the job log. Option (a) is more honest.
- Test: Disable both OPENAI_API_KEY and GROQ_API_KEY; verify job fails with a useful error message.
- Risk: Low. Adding a failure signal.

---

**[PERF-001] [P2] No CDN for video delivery**
- Area: Performance
- File: `lib/storage.ts`, `OPERATIONS.md §6`
- Problem: Videos are served as `307 → Backblaze B2 presigned URL`. No CDN in front of B2. Every view generates a new presigned URL (1 hour TTL) and video bytes come directly from B2 with no edge caching. International users experience B2 latency directly.
- Impact: Slow video loads for distant users. No cache for repeated views of the same video.
- Fix: Add Cloudflare in front of B2 (Cloudflare supports B2 via their partnership — this is different from R2 and doesn't have the VPS-blocking issue). Or use a Cloudflare CDN URL with cache rules on the `/api/media/` presigned redirects.
- Test: Measure video load time from a distant network before and after.
- Risk: Low. CDN addition. Need to verify Cloudflare's B2 integration from this VPS network.

---

**[LEGAL-001] [P1] No business entity / liability shield**
- Area: Legal
- File: `OPERATIONS.md §17 (last paragraph)`
- Problem: "Business entity is currently a sole proprietorship — no liability shield between you personally and the business. Worth revisiting before scaling paid usage further, given real payment processing and biometric-adjacent voice data are both now in play."
- Impact: Personal liability for all business obligations, customer data breaches, GDPR/CCPA violations, and financial disputes.
- Fix: Incorporate (Pty Ltd in Australia, LLC in the US, or equivalent). This is a legal/accounting action, not a code change.
- Risk: Not code-related. External action required.

---

**[LEGAL-002] [P2] DMCA agent not registered**
- Area: Legal
- File: `OPERATIONS.md §17`
- Problem: The DMCA takedown policy exists (added in the security audit pass) but the Copyright Office registration (~$6 filing) that perfects the safe-harbor protection hasn't been done. Without it, the DMCA policy is unenforceable.
- Impact: No statutory protection from copyright liability for user-generated content.
- Fix: Register a DMCA agent at copyright.gov/dmca-agent. Requires legal name, address, and service designation.
- Risk: External. One-time government filing.

---

**[LEGAL-003] [P2] Terms jurisdiction is vague or potentially wrong**
- Area: Legal
- File: `app/terms/page.tsx`, REMEDIATION_STATUS.md CF-007
- Problem: Terms §12 says "governed by the laws of the United States" with no state named. Context clues (ABN/GST references in REMEDIATION_STATUS.md, PRICING_OVERHAUL_BRIEF.md) suggest the operator may be in Australia, making "laws of the United States" potentially incorrect.
- Impact: Unenforceable jurisdiction clause. Could invalidate arbitration provisions.
- Fix: Replace with the actual jurisdiction (country + state/territory) once the business entity is established.
- Risk: Legal advice required. Do not change without a lawyer.

---

### P3 — Optimization / Polish

---

**[CLEAN-001] [P3] DEPLOYMENT.md describes Railway + R2 — production uses Hetzner + B2**
- File: `DEPLOYMENT.md`
- Problem: Entire document is an outdated pre-deployment guide for Railway and Cloudflare R2. Production uses Hetzner VPS + Backblaze B2. The document is actively misleading for any new developer.
- Fix: Archive or overwrite with actual deployment process (covered by OPERATIONS.md). Delete or add "DEPRECATED — see OPERATIONS.md" banner.
- Risk: None. Documentation only.

---

**[CLEAN-002] [P3] `package.json` "worker" script points to non-existent file**
- File: `package.json:11` — `"worker": "tsx worker/index.ts"`
- Problem: `worker/index.ts` does not exist. The worker concept was absorbed into the Next.js process. Running `npm run worker` will error.
- Fix: Remove the "worker" script from `package.json`, or create a real worker process if service separation is planned (see SEC-003).
- Risk: None. Unused script.

---

**[CLEAN-003] [P3] `scratch/` directory committed to repo**
- File: `scratch/clipforge-growth-memo.html`
- Problem: Internal growth planning document is tracked in git and ships in the Docker image.
- Fix: Add `scratch/` to `.gitignore`. Remove from git history with `git rm -r --cached scratch/`.
- Risk: None. Internal document only.

---

**[CLEAN-004] [P3] No structured logging**
- Files: Multiple files in `lib/providers/`, `lib/jobs/`
- Problem: `console.error()` and `console.log()` are used throughout. In production these go to Docker logs with no structure, correlation IDs, or log levels. Finding errors for a specific user or job requires grepping unstructured text.
- Fix: Add a lightweight structured logger (e.g., `pino`) with job ID, user ID, and provider as context fields. Wrap `console.error()` calls.
- Risk: Low. Logging change. No behavioral impact.

---

**[CLEAN-005] [P3] No lint step in CI**
- File: `.github/workflows/deploy.yml`
- Problem: CI runs typecheck + build + tests but no ESLint. Type errors caught by TypeScript but code style issues are not.
- Fix: Add `npm run lint` (ESLint is already configured via `eslint-config-next`) to the `build-check` job.
- Risk: May fail on first run if there are existing lint warnings in the codebase. Fix warnings first.

---

**[PERF-002] [P3] Pexels results are never cached**
- File: `lib/providers/broll.ts`
- Problem: The same keyword searched in multiple videos hits Pexels every time. A simple in-process LRU cache (or Redis) keyed on keyword could eliminate most Pexels calls.
- Fix: Add an in-memory `Map<keyword, BrollScene>` with a 1-hour TTL.
- Risk: Low. Cache invalidation is trivial (keyword → URL is stable).

---

## D. Prioritized Repair Roadmap

### Immediate — Do before next deploy (P0)

| ID | Issue | Effort |
|----|-------|--------|
| BUG-001 | Credit refund in orphan reconciliation | 30 min |
| SEC-001 | Enroll admin TOTP MFA (owner action) | 5 min |
| BUG-002 | Fail loudly when TTS returns null audioUrl | 1 hour |
| UX-002 | Set up support@forgecut.app email forwarding (owner action) | 10 min |

### This Week (P1)

| ID | Issue | Effort |
|----|-------|--------|
| BUG-003 | Add plan check to repurpose + UGC routes | 2 hours |
| AUTH-002 | Handle registration race condition (P2002 → 409) | 30 min |
| REL-001 | Add retry to credit refund on failure | 2 hours |
| PAY-001 | Top up credits on plan upgrade webhook | 2 hours |
| SEC-005 | Document/enforce X-Forwarded-For trust | 2 hours |
| LEGAL-001 | Begin business entity incorporation (owner action) | External |
| LEGAL-002 | Register DMCA agent (owner action) | External |

### This Month (P2)

| ID | Issue | Effort |
|----|-------|--------|
| BUG-004 | Wire credit reservations to generation routes | 4 hours |
| BUG-005 | Parallelize b-roll Pexels fetch | 1 hour |
| VID-001 | Stream repurpose upload (no full-buffer) | 4 hours |
| COST-001 | Populate JobCostRecord in job runners | 4 hours |
| PAY-002 | Enable ledger writes in legacy chargeCredits/refundCredits | 4 hours |
| DB-001 | Switch to prisma migrate workflow | 1 day |
| DB-002 | Add missing indexes | 2 hours |
| TEST-001 | Write unit tests for job runners | 1 day |
| DEPLOY-001 | Add staging environment | 1 day |
| LEGAL-003 | Fix Terms jurisdiction (with legal advice) | External |

### Backlog (P1 architectural / P3 polish)

| ID | Issue | Effort |
|----|-------|--------|
| SEC-002 | Upgrade to Next.js 15+ | 1-2 weeks |
| SEC-003 | Separate render worker from web process | 1 week |
| SEC-004 | Isolate backup credentials (owner action) | 30 min + owner |
| SEC-006 | Nonce-based CSP | 1 week |
| SEC-007 | Restrict image remote patterns | 1 hour |
| PERF-001 | Add CDN for video delivery | 1 day |
| CLEAN-001..005 | Cleanup tasks | 2-3 hours total |

---

## E. Recommended Implementation Order

1. **BUG-001 first** — fix `reconcileOrphanedJobs()` to refund credits. Deploy immediately. Every deploy currently steals money.
2. **SEC-001 (owner)** — enroll admin TOTP. Takes 5 minutes.
3. **BUG-002** — fail loudly on null TTS. Deploy with BUG-001.
4. **UX-002 (owner)** — configure email forwarding. Customer support emails are likely bouncing.
5. **BUG-003** — plan check on repurpose/UGC. Prevents revenue leakage.
6. **AUTH-002** — concurrent registration 500 fix. Simple, safe.
7. **PAY-001** — upgrade webhook credits top-up. Direct customer impact.
8. **COST-001** — JobCostRecord population. Need actual cost data before pricing v2 can go live profitably.
9. **PAY-002** — wire ledger writes to legacy credits. Audit trail.
10. **TEST-001** — job runner tests. Safety net before any further changes to runners.
11. **DB-001** — migrate to prisma migrate. Safety for ongoing schema changes.
12. **DEPLOY-001** — staging environment. Required before pricing v2 cutover.
13. **SEC-002** (Next.js upgrade) — schedule as a dedicated sprint, test thoroughly.
14. **SEC-003** (worker separation) — plan as architecture sprint after staging is in place.

---

## F. Test Plan

**Priority 1 — Add now (covers riskiest un-tested paths):**
- `script-runner.test.ts`: happy path (mock all providers), failure → credit refund, voice clone fallback to TTS, mockScript detection
- `repurpose-runner.test.ts`: happy path, partial clip failure (some succeed), all clips fail, credit refund on total failure
- `register.test.ts`: success, duplicate email (P2002 → 409), invalid input
- `stripe-webhook.test.ts`: upgrade (`subscription.updated`) credits top-up, annual billing

**Priority 2 — Integration tests (against real test DB):**
- Full generation flow: POST `/api/projects/script` → poll `/api/projects/[id]` → verify status `ready`
- Credit reservation: charge → crash → restart → verify refund
- Stripe checkout → webhook → verify User.plan and credits

**Priority 3 — E2E (Playwright):**
- Signup → email verify → first video generation → download
- Checkout → subscription active → billing portal → cancel → plan = free

---

## G. Deployment Verification Checklist

After each significant change:

- [ ] `npm run build` passes locally
- [ ] `npm test` passes (all 20+ tests green)
- [ ] `/api/health` returns 200 with `ok` status
- [ ] Generate a test video end-to-end (script-to-video, free plan)
- [ ] Verify credits are deducted and refunded on failure
- [ ] Verify Stripe webhook test delivery succeeds (Stripe dashboard → Webhooks → Send test)
- [ ] Check Docker logs for errors: `docker logs clipforge-app-1 --tail 50`
- [ ] Verify CSP headers are correct: `curl -I https://forgecut.app | grep content-security`
- [ ] Test a video plays on the dashboard (proxy redirect working)
- [ ] Admin panel accessible, reconciliation report returns clean

**For credits/payment changes specifically:**
- [ ] Run `lib/stripe-reconciliation.ts` manually via `/api/admin/reconciliation` — zero issues
- [ ] Verify `CreditLedgerEntry` rows are written (once PAY-002 is done)
- [ ] Test checkout in Stripe test mode end-to-end

**For deploy/schema changes:**
- [ ] Confirm no orphaned jobs exist before deploy: query `SELECT * FROM "Job" WHERE status IN ('queued', 'processing')`
- [ ] After deploy, confirm `reconcileOrphanedJobs()` logged: `docker logs ... | grep reconciled`

---

## H. Questions Requiring Owner Input

1. **Admin TOTP enrollment** — When will you enroll MFA on your admin account? Code is ready, deployed, waiting for you to scan a QR code.

2. **Business entity** — What is your operating jurisdiction (country and state/territory)? Is there an ABN/ACN? This determines the Terms of Service jurisdiction and GST treatment.

3. **support@forgecut.app forwarding** — Has Porkbun email forwarding been configured? If not, customer emails are bouncing today.

4. **B2 backup credential isolation** — Will you create a second Backblaze B2 application key scoped to a separate backups bucket? This is the single change needed to close SEC-004.

5. **Next.js major upgrade timing** — You previously asked to hold the Next.js 15 upgrade. Is that still the plan? The known CVE (GHSA-955p-x3mx-jcvp) is serious — when should this sprint happen?

6. **Pricing v2 go-live** — The new plans (Starter/Creator/Pro/Business) exist in Stripe test mode. The new pricing engine (`lib/pricing/ledger.ts`, `lib/pricing/plan-config.ts`) is built. What's the trigger for enabling `PRICING_V2_ENABLED=true`? (Recommended prerequisite: COST-001 deployed for at least 2 weeks to collect real cost data first.)

7. **Social publishing timeline** — Do you want to register TikTok/YouTube/Meta developer apps and pursue platform approval? Or keep it as permanent "beta"? The code supports either outcome.

8. **Repurpose/UGC plan eligibility** — BUG-003 requires deciding which of the LEGACY plans (free/hobby/creator/business) can access repurpose and UGC before the fix is deployed. Currently they're accessible to everyone with credits.

9. **Plan upgrade credit policy** — PAY-001 requires a decision: when a user upgrades mid-month, do they get the new plan's full credit allocation immediately, or a pro-rated amount?

10. **DMCA agent registration** — Have you registered a DMCA agent with the U.S. Copyright Office (~$6 filing)? This perfects your safe-harbor protection for user-generated content.

11. **"Videos generated" counter** — The homepage counter includes test/dev renders. Are you comfortable with the current number being displayed, or would you like it filtered to customer-only renders?

12. **Voice cloning consent records** — CF-006 in REMEDIATION_STATUS.md notes there's no persisted consent record (timestamp, IP, voice sample reference). Depending on your jurisdiction, this may be required for biometric data compliance. Is there a timeline to add this?

---

*End of Audit — 2026-08-11 | Read-only inspection. No files were modified.*
