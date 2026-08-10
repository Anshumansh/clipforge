# Clipforge Remediation Status

Tracks execution of `Clipforge-Claude-Code-Full-Remediation-Brief.md` (2026-08-10).

**Pass 1** (`remediation/cf-audit-2026-08-10`): claims correction, `/contact`, credit-refund
bug. Merged to `main` and deployed 2026-08-10, verified live.

**Pass 2** (`remediation/cf-audit-pass2`, this update): security headers, missing Stripe
webhook handlers, first test suite. Not yet merged/deployed — see status of each item below.

**How to read this file:** each requirement gets one of the six statuses the brief
defines. Nothing is marked `COMPLETED_AND_VERIFIED` unless a real end-to-end test
against production (or the local dev build) backs it up — code existing is not
enough per the brief's own rule #6. This is a living document; update it as work
continues rather than starting a new one.

Legend: ✅ `COMPLETED_AND_VERIFIED` · 🟡 `IMPLEMENTED_AWAITING_CONFIGURATION` ·
🔵 `EXTERNAL_APPROVAL_REQUIRED` · 🟠 `OWNER_DECISION_REQUIRED` ·
⚖️ `LEGAL_OR_ACCOUNTING_REVIEW_REQUIRED` · 🔴 `BLOCKED` (not started, real gap)

---

## P0 — Blockers before accepting/promoting paid use

### CF-001: Correct unavailable and unverified public claims — ✅ `COMPLETED_AND_VERIFIED` (this pass)

**Evidence found (confirmed real, not hypothetical):**
- Production `.env` on the VPS has zero `TIKTOK_CLIENT_KEY` / `YOUTUBE_CLIENT_ID` /
  `META_APP_ID` credentials configured — verified via direct SSH grep. `isPlatformConfigured()`
  therefore returns `false` for all three platforms right now.
- `lib/jobs/ugc-runner.ts` uses the identical pipeline as script-to-video
  (`generateAdScript` → `pickBrollScenes` → `synthesizeVoiceover` → `renderScriptVideo`).
  There is no face generation, no lip-sync, no synthetic avatar anywhere in the codebase.
  "Talking-avatar" was marketing language describing a capability that was never built.
- Privacy/Trust pages listed "Cloudflare / Backblaze (or another provider)" — the real,
  sole storage backend is Backblaze B2 (`*.us-west-004.backblazeb2.com`, confirmed via
  VPS `STORAGE_ENDPOINT`). Cloudflare is not part of the storage architecture at all.

**Fixed this pass:**
- Added `getPlatformCapability()` / `getLivePlatforms()` to `lib/social/platforms.ts` —
  single server-controlled source of truth (`unavailable` / `awaiting_approval` / `beta` /
  `live`, driven by env vars including an explicit `SOCIAL_<PLATFORM>_VERIFIED_LIVE`
  flag that only a human flips after manually confirming a real publish).
- Homepage (`app/page.tsx`): hero copy, quick-fact badges, the "Publish straight to:"
  platform row, the stats strip, differentiators, and FAQ answers now render from
  `getLivePlatforms()` instead of hardcoded claims. With 0 platforms configured, the
  page currently shows "Connect & auto-publish (beta)" and an honest fallback paragraph
  instead of live platform badges — this will self-correct the moment real credentials
  are added and a platform is manually marked verified, no code change needed.
  "One credit-based plan" → "One shared credit pool" (per brief item 6).
  "3 platforms you can auto-publish to" → "3 platforms in the social publishing pipeline".
- Removed "avatar" / "talking-avatar" language sitewide: homepage, pricing,
  `/vs/opus-clip`, `/vs/revid-ai`, `/how-it-works`, `/for/ecommerce`, dashboard UGC
  wizard (nav label, page title, layout metadata). Replaced with accurate description:
  voiceover-led, captioned ad video with matched b-roll.
- `/vs/revid-ai`: the UGC-ad comparison row's `winner` was `neutral`; changed to `them`
  — revid.ai's "AI avatars and face swaps" is a real capability Clipforge doesn't have,
  and the previous framing understated that.
- Removed the empty testimonials section and `lib/testimonials.ts` per your instruction
  ("forget about testimonials") — it already rendered nothing (empty array), so this is
  a cleanup, not a behavior change.
- Privacy + Trust pages: "Cloudflare / Backblaze" → "Backblaze B2" (verified provider).
- Kept the existing, accurate "we don't hold SOC 2" statement on `/trust` — no change.

**Files changed:** `lib/social/platforms.ts`, `app/page.tsx`, `app/pricing/page.tsx`,
`app/vs/opus-clip/page.tsx`, `app/vs/revid-ai/page.tsx`, `app/how-it-works/page.tsx`,
`app/for/ecommerce/page.tsx`, `app/for/podcasters/page.tsx`, `app/privacy/page.tsx`,
`app/trust/page.tsx`, `components/dashboard-nav.tsx`, `components/hero-demo.tsx`,
`app/dashboard/new/ugc/page.tsx`, `app/dashboard/new/ugc/layout.tsx` — plus deletion of
`components/testimonials-section.tsx` and `lib/testimonials.ts`.

**Not done this pass:** competitor-comparison rows still lack the source-URL /
retrieval-date / staleness metadata the brief asks for (item 9) — the `vs/*` pages
compare against public competitor pricing pages as of when they were written, with no
automated staleness check. A CI test that fails when a capability is marked `live`
without verification metadata (acceptance test 3) was not built. → 🔴 `BLOCKED`,
follow-up work.

### CF-002: Repair and standardise pricing and credits — 🟡 partial, see detail

**What's already correct (verified by reading the code, not assumed):**
- `lib/credits.ts` `chargeCredits()` uses a single atomic `updateMany` with a
  `credits: { gte: amount }` guard — this is safe under concurrency; Postgres can't let
  two simultaneous requests both succeed past a balance that only covers one. Prevents
  the negative-balance / double-charge race the brief worries about in acceptance test 1.
- All three generation routes (`script`, `repurpose`, `ugc`) charge a flat, single
  `CREDITS_PER_VIDEO = 10` via `resolveGenerationContext().creditOwnerId` *before*
  creating the project or enqueueing the job — so a job never runs unpaid.
- Stripe webhook (`app/api/stripe/webhook/route.ts`) *sets* credits to the plan's fixed
  monthly amount rather than incrementing — replaying `checkout.session.completed` or
  `invoice.paid` is naturally idempotent (resets to the same value, doesn't double-grant).
  This wasn't by explicit design (no stored webhook-event-ID dedup table exists) but the
  current handler logic doesn't have the duplication bug the brief's acceptance test 5
  checks for.

**Real bug found and fixed this pass:** credits were charged up front and **never
refunded on job failure**. If a render failed for any reason — provider timeout,
malformed input, a crash — the user's 10 credits were gone permanently with no
automatic reversal. Added `refundCredits()` to `lib/credits.ts` and
`resolveProjectCreditOwnerId()` to `lib/workspace.ts` (resolves the refund target from
the workspace stored *on the project* at charge time, not the caller's current
membership, so a mid-render workspace change can't misdirect the refund). Wired into
the `catch` block of all three job runners (`script-runner.ts`, `repurpose-runner.ts`,
`ugc-runner.ts`). This is a real customer-money fix, not cosmetic.

**Also fixed:** pricing page said "One credit ≈ one minute of rendered video," which
directly contradicts the flat 10-credits-per-video charge enforced in code (this was
the exact conflict the brief's CF-002 intro calls out). Replaced with the true flat-rate
description.

**Still missing (real gaps, not started):**
- 🔴 No credit ledger — `User.credits` is a single mutable integer, no event log with
  grant/reservation/capture/refund/expiry event types. The refund fix above is a direct
  `increment`, not a ledger entry. A ledger is a schema migration + rewrite of every
  credit-touching code path; genuinely out of scope for this pass.
- 🔴 No stored webhook-event-ID table — idempotency currently comes from the handler's
  overwrite semantics being accidentally safe, not from an explicit dedup guard.
  Out-of-order events (e.g. `customer.subscription.updated` arriving after a later state)
  aren't protected against.
- 🔴 No credit-cost display to the user before they confirm generation beyond the
  static "10 credits per video" line already on the wizard pages (already accurate, not
  dynamically computed from a server-side cost service).
- 🟠 `OWNER_DECISION_REQUIRED`: the Business plan's 2,500 credits / ~250 videos ratio
  hasn't been checked against real per-video provider cost (OpenAI/Groq/ElevenLabs/TTS/
  Pexels/render compute) — no unit-economics instrumentation exists yet (see CF-021).

### CF-003: Fix contact, identity and customer-help routes — ✅ `COMPLETED_AND_VERIFIED` (routes), 🟠 identity fields open

**Fixed this pass:** `/contact` did not exist at all — the footer's "Contact" link was a
bare `mailto:` with no page behind it. Built a real `/contact` page
(`app/contact/page.tsx`) with six differentiated categories (general support, billing &
refunds, privacy requests, copyright, security disclosure, voice-cloning abuse) — each
pre-fills a subject line, all currently route to the one real monitored inbox
(`support@forgecut.app`), and the page says so explicitly rather than implying separate
inboxes that don't exist. Added `/.well-known/security.txt` (RFC 9116) pointing to the
same contact. Footer now links to `/contact` instead of a bare `mailto:`. Verified both
routes render correctly in a local build (`npm run build` succeeded, `/contact`
statically prerendered) and in a live browser check.

**Not done — needs your input, not a code decision:**
- 🟠 Legal name, trading name, ABN, business/service address, support hours are not
  published anywhere on the site. The `/contact` page now says explicitly that this
  will be published "once finalized" rather than inventing placeholder values. → see
  `OWNER ACTIONS REQUIRED` below.
- 🔴 No automated link-checker in CI for footer/nav links (brief acceptance test 1).
- 🔴 No mail-delivery-failure monitoring beyond Resend's own dashboard.

### CF-004: Email verification and account-abuse prevention — 🔴 `BLOCKED`, not started this pass

Existing state (from earlier in this build, not re-verified this pass): registration
does NOT require email verification before a free account can generate paid-provider
work; `lib/rate-limit.ts` provides in-memory (not distributed) rate limiting on auth and
generation routes; no CAPTCHA on registration or the anonymous demo; anonymous demo
generations run through the same job runners as paid ones with a per-IP rate limit but
no separate low-priority queue or explicit daily-spend cap; no documented proxy/IP-header
trust boundary (if the app is behind Caddy, `X-Forwarded-For` trust needs to be pinned
explicitly or rate limits can be bypassed by a forged header). None of this was touched
this pass — real, non-trivial follow-up work.

### CF-005: Payment, subscription and webhook integrity — 🟡 improved this pass, gaps remain

Signature verification via raw body: ✅ present (`stripe.webhooks.constructEvent`).
Credits are not granted from a success-page redirect — only the webhook grants credits: ✅.
Self-service billing portal: ✅ exists (`/api/stripe/portal`).

**Added this pass:** handlers for `invoice.payment_failed` (flags `User.billingIssue =
"past_due"`, does *not* touch plan/credits — Stripe's own dunning retries handle
recovery; a truly failed subscription still arrives as its own
`customer.subscription.deleted` event, unchanged, which does downgrade to free),
`charge.dispute.created` (retrieves the charge to find the customer, flags
`billingIssue = "disputed"`, logs server-side), and `customer.deleted` (clears the
now-dangling `stripeCustomerId`/`stripeSubscriptionId` and downgrades to free — rare,
but a customer deleted from the Stripe dashboard would otherwise leave the account
pointing at a nonexistent Stripe object, breaking the next checkout/portal attempt).
`billingIssue` is cleared on `checkout.session.completed` and successful `invoice.paid`.
Added a schema field (`User.billingIssue String?`, pushed via `prisma db push`) and a
billing-page banner so an affected customer actually sees this instead of it being
silent backend state. Covered by the migration's own inline comment for the "why"
(doesn't touch plan/credits directly).

**Still missing:** 🔴 no stored webhook-event-ID / reconciliation report comparing
Stripe state vs local entitlement state (an out-of-order `customer.subscription.updated`
arriving after a later state isn't protected against). Tax/GST settings: ⚖️
`LEGAL_OR_ACCOUNTING_REVIEW_REQUIRED` — not something code should decide.

### CF-006: Voice-cloning safety and consent — 🟡 partial

**What exists:** voice cloning is gated to paid plans (`canUseVoiceClone(plan)`); the UI
requires an affirmative consent checkbox and the server independently re-checks
`voiceConsent === "true"` on the API route (not just trusting the client) — this was
verified by reading `app/api/projects/script/route.ts` this pass. Voice sample files are
stored under the user's own private media prefix, served only via short-lived signed
URLs (same mechanism as rendered video).

**Missing (real gaps):** 🔴 no separate consent *record* — the checkbox gates the
request but nothing persists consent version, timestamp, IP, or intended use as an
auditable row; a "did this user consent to clone this specific voice" question can't be
answered later from data, only inferred from "the request would have been rejected
otherwise." 🔴 No abuse-reporting workflow beyond the new `/contact` page's category
(intake exists now; investigation/suspension workflow doesn't). 🔴 No per-account
volume limits or manual-review thresholds. 🔴 No global kill switch env var. 🟠 An active
spoken-consent/liveness check is explicitly `OWNER_DECISION_REQUIRED` per the brief's own
item 4 — flagging, not deciding.

### CF-007: Legal and privacy pages must match reality — 🟡 one fix made, rest is ⚖️

**Fixed this pass:** the storage-provider misstatement (see CF-001 — Cloudflare removed,
Backblaze B2 named correctly) on both Privacy and Trust pages.

**Explicitly not touched, and shouldn't be by code alone:**
- ⚖️ Terms §12 "governed by the laws of the United States" with no state named, and an
  unnamed arbitration mechanism. I did not invent a jurisdiction, arbitration provider,
  or entity name to replace this — the brief's own rule says not to, and I don't have
  verified information about where this business is actually legally registered. **This
  needs your input**: what is the actual operating entity and its jurisdiction? (Earlier
  business-checklist context in this project referenced ABN/GST, which is
  Australia-specific — if that's accurate, "laws of the United States" may be flatly
  wrong, not just vague. I can't tell from the code which is true.)
- ⚖️ Refund/no-refund language, backup-retention-after-deletion language, and
  versioned-acceptance-tracking for Terms/Privacy changes were not audited this pass.
- 🔴 No account-deletion → tombstone → backup-restore-doesn't-resurrect-deleted-data test
  exists or has been run.

---

## P1 — Security, reliability, data protection

All P1 items below are 🔴 `BLOCKED` — not started this pass. Each is large enough to
warrant its own dedicated pass rather than a partial, risky edit bolted onto this one:

- **CF-008** (separate worker/render process from web process): the render pipeline
  (Remotion, headless Chrome, ffmpeg, voice cloning) currently runs in the same Next.js
  process as web/API traffic. No dedicated worker container, no lease/heartbeat job
  model beyond the existing `Job` status field. A render memory spike can affect the
  same process serving login/billing/dashboard.
- **CF-009** (capacity telemetry): no queue-wait/render-duration/p95/p99 instrumentation,
  no admission control, no capacity dashboard.
- **CF-010** (backup isolation) — **confirmed real gap, evidence checked this pass**:
  `scripts/backup-db.sh` uploads to `s3://$STORAGE_BUCKET/backups/` using the *same*
  `STORAGE_ACCESS_KEY_ID` / `STORAGE_ACCESS_KEY_SECRET` as live media access. There is
  no separate bucket, no separate least-privilege credential, and no evidence backups are
  independently encrypted. This means the credential set that can read/write/delete a
  customer's video can also read/write/delete the database backups. Fixing this requires
  creating a second Backblaze B2 application key scoped to a backup-only bucket — a
  Backblaze-console action only you can take (see `OWNER ACTIONS REQUIRED`); I can update
  the backup script to use it once it exists. No monthly restore-drill exists.
- **CF-011** (auth/session/authorization): no MFA on the admin account (confirmed —
  `isAdmin` is a plain boolean gate behind normal password login, verified again this
  session while testing the admin panel). Cross-tenant IDOR testing across projects,
  media, teams, brand kits, API keys was done ad hoc during feature development this
  session (e.g., real two-account workspace tests) but no automated regression suite
  exists. Admin audit logging *does* exist and was verified end-to-end this session
  (`AdminAction` model, tested via real grant-credits/comp-plan/audit-log flow with
  disposable test accounts — see this session's admin-panel verification).
- **CF-012** (SSRF / upload validation / sandboxing / CSP) — 🟡 partial, added this
  pass: a real CSP, HSTS, X-Frame-Options/frame-ancestors, X-Content-Type-Options,
  Referrer-Policy, and a Permissions-Policy denying camera/mic/geolocation, via
  `next.config.js` `headers()`. The CSP is `default-src 'self'` with no wildcard host
  allowances anywhere — verified this is actually correct for what the app loads (media
  goes through the same-origin `/api/media/*` proxy, fonts are self-hosted via
  `next/font`, there's no client-side Stripe.js, no analytics scripts, and a grep of
  `components/` and `app/` found zero client-side `fetch()` calls to an absolute
  external URL). `script-src`/`style-src` still allow `'unsafe-inline'` (Next.js
  hydration and inline `style={}` attributes need it without a nonce plumbed through
  middleware) — tightening to nonce-based CSP is real follow-up work, not done. Verified
  locally: headers present via `curl -I`, zero CSP-violation console errors on a fresh
  homepage load. A quick recon did not find an obvious raw-user-supplied-URL fetch
  (Repurpose's `sourcePath` and voice clone's reference audio both come from files
  already uploaded to Clipforge's own storage, not directly from user-typed URLs; Trend
  Radar only calls the official, hardcoded YouTube Data API base URL) — that is not the
  same as a full SSRF audit against redirects/DNS-rebinding/private-IP-encoding per the
  brief's acceptance tests, which hasn't been done. No container scanning in CI.
- **CF-013** (secrets/dependency inventory): no formal inventory document exists yet
  (this pass's VPS env checks were targeted, not exhaustive). Provider timeouts/circuit
  breakers are inconsistent across `lib/providers/*.ts` (spot-checked, not audited).
  `npm audit` run this pass found a real, currently-unpatched issue: Next.js 14.2.15 has
  a known advisory (unauthenticated disclosure of internal Server Function endpoints,
  GHSA-955p-x3mx-jcvp) plus transitively-vulnerable `postcss`. The fix requires Next.js
  15/16, a breaking major-version upgrade — deliberately **not** done in this pass
  (too large a change to bundle into an audit-fix commit without its own dedicated
  regression pass) but flagged here as a real, specific, currently-open vulnerability
  rather than left silently undiscovered.
- **CF-014** (deployment safety) — 🟡 improved this pass: added `vitest` (first test
  framework in this repo — there was none) with two real unit-test files
  (`lib/credits.test.ts`, `lib/workspace.test.ts`, 6 tests, all passing) covering the
  exact credit-charge/refund-atomicity and workspace-credit-owner-resolution logic
  touched in pass 1. Wired `npm test` into `.github/workflows/deploy.yml` as a real gate
  before deploy (was previously only typecheck + build). Still no lint step in CI, no
  integration tests, no dependency/container/secret scanning, no staging environment.

---

## P2 — Product quality, customer experience, operations

All 🔴 `BLOCKED`, not started: CF-015 (no regression fixture suite or measurable
per-feature acceptance criteria beyond "it rendered"), CF-016 (no first-party analytics;
the homepage's "videos generated" counter — `db.project.count({ where: { status:
"ready" } })` — has no bot/test/admin exclusion and counts every ready project ever
rendered on this instance, including the many feature-verification renders made
throughout this project's build-out, not just real customer usage; flagging per brief
item 5 rather than silently leaving it — the number shown is real and unfabricated, but
it isn't a "customers generated N videos" metric even though it can read as one), CF-017 (no
formal support-intake categorization beyond the new `/contact` page; no runbooks), CF-018
(no automated accessibility testing has been run), CF-019 (no central feature registry —
plan gating exists ad hoc via `lib/plans.ts` `canX(plan)` functions, which work but
aren't a single source of truth with `hidden/alpha/beta/live` states), CF-020 (account
deletion exists per earlier session work but hasn't been re-verified against the full
scope list — OAuth tokens, API keys, active sessions — in this pass).

## P3 — Business measurement and owner decisions

All 🟠/⚖️/🔴, none started this pass: CF-021 (no unit-economics instrumentation — the
Business-plan 2,500-credit ratio is flagged per brief item 5 as needing real cost data
before it can be called profitable), CF-022 (no funnel/retention dashboard), CF-023
(customer research template not yet created), CF-024 (business admin checklist not yet
created).

---

## Database and domain-control models required by the brief

| Model | Status |
|---|---|
| Credit ledger | 🔴 not built — still a mutable `User.credits` integer |
| Job lifecycle (leased/heartbeat) | 🔴 not built — `Job.status` is a simple enum, no lease/heartbeat |
| Webhook receipt (dedup) | 🔴 not built |
| Feature registry | 🔴 not built — ad hoc `lib/plans.ts` gates |
| Consent record | 🔴 not built — checkbox gate only, no persisted record |
| Admin audit event | ✅ exists and verified (`AdminAction`) |
| Deletion request/tombstone | 🔴 not verified this pass |
| Policy acceptance | 🔴 not built |
| Data-retention job state | 🔴 not built (cron cleanup for demo media exists per earlier session work, but not a general retention-schedule model) |

---

## Test matrix

🟡 **Just started.** `vitest` is now installed and wired into the CI deploy gate
(`npm test` runs before `deploy` in `.github/workflows/deploy.yml`), with 6 real unit
tests covering credit charge/refund atomicity and workspace credit-owner resolution —
the two pieces of logic this remediation program actually changed. Everything else
claimed as "done" throughout this project (including most of this remediation pass) was
still a real, manual, production/local end-to-end check — script runs, curl sessions,
browser checks — not an automated regression test. That's worth being direct about: most
of this codebase still has nothing to catch a future regression except a human running
it by hand. Webhook-replay tests, cross-tenant IDOR tests, and integration tests against
a real (non-production) database are the highest-value next additions.

---

## Deployment gates

Per the brief's own instruction not to collapse this into one irreversible deploy:

- **Gate 1 (safe public truth):** claim corrections (CF-001) and contact repair (CF-003)
  are done this pass. Pricing-copy correction done. Feature gating (hiding unverified
  claims) done for social publishing. **This gate is realistically close** — remaining
  before merge: a human read-through of the new `/contact` and homepage copy, and a
  decision on the Terms jurisdiction question above.
- **Gates 2–5:** not started in full. Pass 2 made real progress on pieces of Gate 3
  (CSP/security headers, one Stripe webhook-integrity gap closed) and Gate 5 (first test
  suite exists, wired into the deploy gate) — but the larger items in each (credit
  ledger, worker separation, MFA, backup isolation, restore drills, unit economics)
  remain sequenced future work, not something to compress into this pass.

Pass 1 (`remediation/cf-audit-2026-08-10`) is merged to `main` and deployed. Pass 2
(`remediation/cf-audit-pass2`) is committed on its own branch, typechecked, built, and
test-suite-verified locally — not yet merged/deployed as of this update.

---

## OWNER ACTIONS REQUIRED, ordered by urgency

1. **Backup credential isolation (CF-010).** Create a second Backblaze B2 application
   key scoped only to a new `clipforge-backups` bucket (read/write/delete on that bucket
   only — not the media bucket). Send me the new key ID/secret via your usual secrets
   process and I'll update `scripts/backup-db.sh` and the VPS `.env` to use it, then
   verify a real backup round-trip with the new credential.
2. **Next.js version decision (CF-013, found this pass).** Production runs Next.js
   14.2.15, which has a known advisory (GHSA-955p-x3mx-jcvp — unauthenticated disclosure
   of internal Server Function endpoints) plus a vulnerable transitive `postcss`. The fix
   is a major-version upgrade to Next 15/16, which is a real breaking change across the
   App Router — I did not do this in the same pass as the audit fixes, since bundling a
   framework major-version bump into the same commit as claims/security-copy corrections
   would make it much harder to isolate what broke if something did. Want me to scope
   and run that upgrade as its own dedicated pass next?
3. **Legal jurisdiction (CF-007).** Tell me the actual operating entity name and its
   real jurisdiction (country/state) so Terms §12 can say something true instead of a
   vague placeholder. If you don't have this decided yet, that's fine — it's flagged as
   `LEGAL_OR_ACCOUNTING_REVIEW_REQUIRED` and Gate 1 doesn't strictly require it, but it
   should not stay indefinitely vague once you're taking real payments.
4. **Business identity for `/contact` and Terms** (CF-003/CF-024): legal name, ABN (or
   equivalent), and a service address, once you have them.
5. **Decide social publishing's real timeline** — do you want to actually register
   TikTok/YouTube/Meta developer apps and pursue platform approval, or leave this as a
   permanent "beta / in approval" feature? The code now supports either outcome without
   further changes; this is a business decision, not a blocker.
6. **Everything in CF-024** (ABN, GST/Stripe tax treatment, business banking, insurance,
   Australian tech-lawyer review, DMCA agent registration) — external, non-code, and not
   something I can complete or verify.

---

*This document reflects the state after two remediation passes: pass 1 (P0 claims
correction, contact routes, the credit-refund bug — merged and live) and pass 2
(security headers, Stripe webhook-integrity gaps, first test suite — committed, pending
merge). It intentionally does not claim completion of P1–P3 in full — those remain real,
separately-scoped engineering programs.*
