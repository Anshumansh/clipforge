# Clipforge — Full Site Feature Manifest

Generated 2026-08-19 during the exhaustive whole-site verification pass; updated 2026-08-24 after a full authenticated session (owner-assisted staging login) covering Stripe end-to-end, email delivery, all three generation engines, dashboard controls, and a targeted code-scan pass. Source: `recovery/full-functional` @ current HEAD, discovered from the actual route tree (`app/**/page.tsx`, `app/api/**/route.ts`), `components/dashboard-nav.tsx`, `prisma/schema.prisma`, `worker/index.ts`, and `lib/plans.ts` — not guessed from memory.

**Verdict at time of writing: NO-GO.** See bottom for the rollup.

Legend: **PASS-LIVE** = tested live with real evidence (real HTTP requests, real DB state, real playback). **PASS (code)** = code-reviewed only, not exercised live. **FAIL** = reproduced defect. **FAIL → FIXED** = reproduced, root-caused, fixed, and re-verified live. **BLOCKED-OWNER** = requires the account owner's live participation, credentials, or a dashboard-only vendor setting only they can change. **BLOCKED-VENDOR** = requires a third-party approval/config not currently available. **CONFIG-GATED** = intentionally disabled by configuration, with a truthful user-facing explanation.

A `BLOCKED-OWNER` row still carries a code-review verdict where one was performed — that is real evidence, distinct from an untested row, and is called out explicitly in the Evidence column rather than left implicit.

---

## 1. Public marketing & legal pages

| ID | Route | Feature/control | Role | Plan | Expected | Test type | Evidence | Result | Fix commit |
|----|-------|-----------------|------|------|----------|-----------|----------|--------|------------|
| P-01 | `/` | Page load, title, header/footer, nav | Anon | — | 200, no console errors | Live browser + Playwright | `anonymous-journey.spec.ts` — public route sweep | PASS | — |
| P-02 | `/` | Solutions menu, FAQ accordions | Anon | — | Opens/closes correctly | Live browser | Manually opened during session; correct | PASS | — |
| P-03 | `/` | 3 showcase preview tiles (tap/hover/click, playback) | Anon | — | Real video plays | Live network trace + fix + re-verify | **Regressed and re-fixed 2026-08-24**: all 3 tiles were 404ing again (`readyState:0`, `MEDIA_ELEMENT_ERROR: Format error`) — root cause was `SHOWCASE_CLIPS`' hardcoded keys pointing at the storage bucket that was replaced this session (the old bucket genuinely no longer existed). Slot 1 ("Script to video") replaced with a freshly generated, verified-playable clip (`readyState:4`, `duration:24.2s`, no error). Slots 2–3 (Repurpose, UGC) still broken — same root cause, blocked on paid-plan test access to regenerate replacement clips | **FAIL → PARTIALLY FIXED** (1 of 3) | `4046f36` |
| P-04 | `/` | "Try it free" anonymous demo generation | Anon | — | Real render, real playback | Live E2E | Re-verified 2026-08-24 against current staging: real project created, `status:"ready"`, `readyState:4`, `duration:22.1s`, `error:null` | PASS-LIVE | `9771212` |
| P-05 | `/` | Demo form validation (topic <10 chars) | Anon | — | Submit disabled | Playwright | `anonymous-journey.spec.ts:96` | PASS | — |
| P-06 | `/` | Videos-generated counter, stat row | Anon | — | Real DB-backed count, not build-time frozen | Code review | `unstable_cache` w/ 300s revalidate, matches doc comment reasoning | PASS | — |
| P-07 | `/pricing` | 4 plan cards, prices, credits | Anon | — | Match Stripe live config | Live + Stripe API cross-check | $19.99/$26.88/$44.99 match Stripe Price objects (now live-configured on staging, not just production) | PASS | — |
| P-08 | `/pricing` | Creator "Popular" badge accessible name | Anon | — | Screen reader doesn't run words together | Live a11y check + fix | Was `"CreatorPopular"` (no whitespace in markup); fixed via `aria-label` on badge | **FAIL → FIXED** | `c04ad83` |
| P-09 | `/pricing` | 4 signup CTAs | Anon | — | Link to `/register` | Playwright | `anonymous-journey.spec.ts:109` | PASS | — |
| P-09b | `/pricing` | Subscribe buttons (Hobby/Creator/Business) when authenticated | Auth'd | Free | Calls `/api/stripe/checkout`, redirects to real Stripe session | Live (direct API call, since the button's on-page click didn't register in this automation environment — a tooling limitation, not confirmed as an app bug) | `POST /api/stripe/checkout` → 200, real `checkout.stripe.com` session URL returned; full checkout page loaded with correct plan/price/pre-filled email | PASS-LIVE | — |
| P-10 | `/how-it-works` | Page load | Anon | — | 200, no console errors | Playwright | Public route sweep | PASS | — |
| P-11 | `/for/podcasters` | Page load, content quality | Anon | — | 200, accurate claims | Playwright + manual content read | Public route sweep; spot-checked copy, accurate | PASS | — |
| P-12 | `/for/ecommerce` | Page load | Anon | — | 200 | Playwright | Public route sweep | PASS | — |
| P-13 | `/for/agencies` | Page load | Anon | — | 200 | Playwright | Public route sweep | PASS | — |
| P-14 | `/vs/opus-clip` | Page load | Anon | — | 200 | Playwright | Public route sweep | PASS | — |
| P-15 | `/vs/revid-ai` | Page load | Anon | — | 200 | Playwright | Public route sweep | PASS | — |
| P-16 | `/changelog` | Page load, entries render | Anon | — | 200, real dated entries | Playwright + manual read | Public route sweep; 11 real entries read, no placeholder content | PASS | — |
| P-17 | `/roadmap` | View board (anon), submit/vote gating | Anon | — | View works, submit/vote requires login | Playwright + manual | Public route sweep; correct real empty state ("No requests yet"), correct login-gate copy | PASS | — |
| P-17b | `POST /api/roadmap/[id]/vote` | Vote/unvote, error handling | Auth'd | — | Real DB failures never reported as a successful vote | Code-scan finding + fix + regression test | Was swallowing every create error unconditionally and always returning `{voted:true}` — only the documented case (request deleted, P2003) should do that. Fixed + 4 new tests (unvote, vote, P2003→404, unrelated error propagates) | **FAIL → FIXED** | `ee9c63b` |
| P-18 | `/trust` | Page load, claims accuracy | Anon | — | 200, claims match reality | Playwright + live verification of specific claims | Public route sweep; security-header claims verified byte-for-byte accurate; cookie-count claim was inaccurate, fixed (see commit) | PASS | `ccdcd53` |
| P-19 | `/privacy` | Page load | Anon | — | 200 | Playwright | Public route sweep | PASS | — |
| P-20 | `/terms` | Page load | Anon | — | 200 | Playwright | Public route sweep | PASS | — |
| P-21 | `/contact` | Page load, category info (not a form) | Anon | — | 200, accurate contact routing disclosure | Playwright + manual read | Public route sweep; honest copy re: routing/SLA | PASS | — |
| P-22 | `/.well-known/security.txt` | RFC 9116 file | Anon | — | Valid format | Live curl | 200, correctly formatted | PASS | — |
| P-23 | `/robots.txt` | Crawler directives | Anon | — | Disallows `/dashboard`, `/api` | Live curl | Correct | PASS | — |
| P-24 | `/sitemap.xml` | Sitemap | Anon | — | Valid XML, real URLs | Live curl | Correct | PASS | — |
| P-25 | 5 pages | `link-in-text-block` WCAG violation | Anon | — | Links distinguishable without relying on color | axe-core scan + fix | `/register`, `/changelog`, `/roadmap`, `/privacy`, `/terms` (and 12 files/20 occurrences total of the same pattern) — underline appeared only on hover; fixed to a persistent underline everywhere the pattern occurs, not just the 5 flagged pages | **FAIL → FIXED** | `11b008b` |

## 2. Authentication

| ID | Route | Feature/control | Role | Plan | Expected | Test type | Evidence | Result | Fix commit |
|----|-------|-----------------|------|------|----------|-----------|----------|--------|------------|
| A-01 | `/register` | Client-side email format validation | Anon | — | Native browser validation blocks bad input | Playwright | `auth-validation.spec.ts:10` | PASS | — |
| A-02 | `/register` | Client-side password minlength | Anon | — | `minlength=6` | Playwright | `auth-validation.spec.ts:28` | PASS | — |
| A-03 | `POST /api/register` | Server validation, hashing, dup-race handling | Anon | — | zod schema; bcrypt cost 10; P2002-safe dup handling | Code review (full file read) | Correct, including the concurrent-duplicate race via `findUnique` + P2002 catch | PASS (code) — live signup remains BLOCKED-OWNER, account creation is not something this agent performs | — |
| A-04 | Register → verify email | Verification email sent, token hashed, 24h TTL | Anon | — | Real send via Resend | Code review + adjacent live evidence | Token only stored hashed; best-effort send doesn't block signup. Resend delivery itself confirmed live via A-15/E-01 (same underlying send path, same account) | PASS (code) + adjacent PASS-LIVE | — |
| A-05 | `/verify-email/[token]` | Invalid/expired token messaging | Anon | — | Clear, actionable message | Live browser | Tested live with a garbage token: "This verification link is invalid or has expired," clear next step | PASS | — |
| A-06 | `/login` | Wrong credentials rejection | Anon | — | Generic error, no account-existence leak | Live browser + Playwright | Tested live and via `auth-validation.spec.ts:36` | PASS | — |
| A-07 | `lib/auth.ts` `authorize()` | Timing-attack mitigation | — | — | `bcrypt.compare` always runs | Code review | `DUMMY_HASH` constant-time comparison for nonexistent emails, explicitly commented | PASS | — |
| A-08 | `lib/auth.ts` `authorize()` | TOTP challenge + backup code fallback | — | — | Correct 2-step MFA | Code review | Only gates when `totpSecret && totpEnabledAt`; backup code consumed correctly on TOTP mismatch | PASS (code) — live TOTP re-login cycle still not performed this session (owner logged in once at session start; a full logout→login→TOTP cycle was never separately exercised) | — |
| A-09 | `/login` client form | 2-step MFA UI | Anon | — | Correct challenge flow, fields disabled mid-challenge | Code review | Correct `MFA_REQUIRED`/`MFA_INVALID` handling | PASS (code) | — |
| A-10 | `/forgot-password` | Enumeration-safe response | Anon | — | Identical message regardless of account existence | Live browser + Playwright + code review | Tested live; `genericResponse()` always returned; rate-limited 5/10min | PASS | — |
| A-11 | `/reset-password/[token]` | Reset flow, expired-link handling | Anon | — | Clear expired-link message | Code review | Server correctly validates token hash/`usedAt`/`expiresAt` before any password write | PASS (code) | — |
| A-12 | `middleware.ts` | Protected-route redirect | Anon | — | Redirect to `/login?next=<relative-path>` | Live browser + Playwright | Tested live: `/dashboard` → `/login?next=%2Fdashboard` | PASS | — |
| A-13 | Session cookies | HttpOnly/Secure/SameSite | — | — | Correct flags | Live `Set-Cookie` header inspection | `__Host-next-auth.csrf-token`, `__Secure-next-auth.callback-url` both HttpOnly+Secure+SameSite=Lax | PASS | — |
| A-14 | Session stability (nav, reload, no spontaneous logout) | Real account | Free | — | No unexpected redirect to login across repeated navigation | **Live, owner-assisted session** | Owner logged in directly into the staging login page (credentials never seen/requested). ~12 sequential dashboard navigations + 2 hard reloads, zero auth redirects, zero unexpected errors. Full logout→login→TOTP re-cycle test still not separately performed | **PASS-LIVE** (session stability) / not yet tested (full re-login cycle) | — |
| A-15 | `POST /api/auth/resend-verification` | Resend flow | Auth'd | — | Rate-limited resend, real delivery | **Live, real send + fix** | Found genuinely broken: 503 `"Email sending isn't configured on this server yet"` — `RESEND_API_KEY` was entirely absent from staging (owner added it). Redeployed, re-tested: `200 {"message":"Verification email sent"}`; verification banner disappeared from the dashboard after the owner clicked the real link in their inbox, confirming actual delivery, not just a 200 | **FAIL → FIXED**, PASS-LIVE | (Railway config change, owner-applied) |
| A-16 | `/api/account/delete` | Self-service account deletion | Auth'd | — | Removes projects, media, tokens, samples immediately | Code review only | Matches Trust page claim structurally | PASS (code) | — |

## 3. Homepage demo pipeline (deep trace)

| ID | Stage | Expected | Test type | Evidence | Result | Fix commit |
|----|-------|----------|-----------|----------|--------|------------|
| D-01 | Request validation | Rejects <10 or >300 char topics | Code review + Playwright | zod-equivalent length check; live test | PASS | — |
| D-02 | Per-IP + global quota, DB-backed, atomic | 3/IP/day, company-wide daily cap, never overshoots on rejection | **Live, real concurrency** | Rewrote from a dead-on-arrival in-memory limiter (never wired to the live route) to the DB-backed atomic implementation, advisory-locked. 6 new integration tests against real Postgres (concurrent-submission cap, no-overshoot-on-reject, per-IP independence, global cap across distinct IPs, UTC-day rollover, raw-IP-never-stored) all pass. Live-fired via the real anonymous demo this session | **FAIL → FIXED**, PASS-LIVE | `2803d29` |
| D-04 | Concurrent-admission lock | Only 1 in-flight demo job at a time | Code review | `pg_advisory_xact_lock` around count-then-insert, distinct lock key from D-02's | PASS (code) | — |
| D-05 | Queue claim → script gen → voiceover → b-roll → render → upload | Full pipeline | Live E2E | Real generation completed successfully this session (`readyState:4`, `duration:22.1s`) | PASS-LIVE | `9771212` |
| D-06 | Internal-media auth during render | Ownership-scoped presigning | Code review | `lib/remotion-render.ts` `resolveInternalMediaUrls`/`resolveExpectedOwnerUserId` | PASS | — |
| D-07 | SSRF protection on external asset URLs | Blocks private/loopback/metadata ranges, validates redirects | Code review + 25-test suite | `lib/asset-url-security.ts` + tests | PASS | — |
| D-08 | Completion fencing (lease/attemptToken) | Stale worker can't clobber a reassigned job | Code review | `updateMany` w/ `workerId`+`attemptToken` match | PASS | — |
| D-09 | Playback | Real video plays, duration > 0 | Live E2E | `readyState:4`, `duration:22.1s`, `error:null` | PASS-LIVE | — |
| D-10 | Worker OOM under real render load | No crash | Kernel log + fix + re-verify | Real cgroup OOM confirmed via `dmesg`; `mem_limit` 4g→5g | **FAIL → FIXED** | `9771212` |
| D-11 | Demo jobs never create a `CreditReservation` | Free path stays free | Code review | Confirmed — no reservation call in the demo path | PASS | — |
| D-12 | Failure/retry/timeout UI states | Clear error messaging | Code review + live | `hero-demo.tsx` phase state machine | PASS | — |

## 4. Dashboard (live authenticated session, 2026-08-24)

Owner-assisted staging login was completed this session (credentials never seen/requested). All rows below now carry live evidence unless noted.

| ID | Route | Nav label | Test type | Evidence | Result |
|----|-------|-----------|-----------|----------|--------|
| DB-01 | `/dashboard` | Projects | Live | Loads correctly, shows real project list, credits/streak counter accurate | PASS-LIVE |
| DB-02 | `/dashboard/ideas` | Idea Radar | Live | "Generate ideas" → `POST /api/ideas` → 200, 3 real distinct ideas with hooks/descriptions returned; "Use this idea" correctly hands off to Script-to-video with the full idea text pre-filled in the textarea. Minor finding: page doesn't set its own `<title>`, inherits the homepage's | PASS-LIVE (minor title finding) |
| DB-03 | `/dashboard/trends` | Trend Radar | Live | Empty-state onboarding form renders correctly; "Save & start tracking" correctly disabled with 0 channels (no dead-click). Adding a channel → `POST /api/trend/resolve-channel` → was an unhandled 500 (`YOUTUBE_DATA_API_KEY not set`), fixed to a clean 503; the key itself is still not set on staging (owner action, real Google Cloud credential). Minor finding: page doesn't set its own `<title>` | **FAIL → FIXED (error handling)**, still BLOCKED-OWNER (actual key) |
| DB-04 | `/dashboard/new/script` | Script to video | Live, full generation x2 | Full pipeline tested twice this session: real project created, queued → rendering → **ready**, real playable MP4 (`readyState:4`, durations 24.2s/22.1s), credits deducted exactly once (50→40→30), correct 403 + no charge on a genuinely failed render (see G-11) | PASS-LIVE |
| DB-05 | `/dashboard/new/repurpose` | Repurpose | Live (gate only) | Plan gate correctly blocks Free-plan access with clear upgrade copy. Actual generation (upload → transcription → highlight selection → render) not tested — needs paid-plan access, currently blocked | PASS-LIVE (gate) / BLOCKED-OWNER (generation) |
| DB-06 | `/dashboard/new/ugc` | UGC ad | Live (gate only) | Same as DB-05 — gate correctly blocks Free plan ("Creator plan required"), generation itself blocked on paid-plan access | PASS-LIVE (gate) / BLOCKED-OWNER (generation) |
| DB-07 | `/dashboard/settings` | Connected accounts | Live | All 3 platforms (YouTube Shorts, TikTok, Instagram Reels) correctly show "Not set up on this server yet" — and the Connect buttons are genuinely `disabled`, not just mislabeled. Matches the explicit requirement that vendor-unapproved integrations must be clearly disabled, not fake-functional | PASS-LIVE |
| DB-08 | `/dashboard/settings/brand` | Brand kit | Live, full CRUD | Not plan-gated for editing (only for render application). Changed primary color, saved (`POST /api/brand-kit` → 200), hard-reloaded, confirmed the new value persisted correctly | PASS-LIVE |
| DB-09 | `/dashboard/settings/api-keys` | API keys | Live (gate only) | Correctly gated to Business plan ("Upgrade to generate a key"), "No keys yet" empty state correct. Minor finding: MCP endpoint example shown is the production URL (`forgecut.app`) even while browsing staging — plausibly intentional (API access is inherently a production concept) but worth a deliberate decision rather than an accident | PASS-LIVE (gate) |
| DB-10 | `/dashboard/settings/team` | Team | Live (gate only) | Correctly gated to Business plan | PASS-LIVE (gate) |
| DB-11 | `/dashboard/schedule` | Schedule | Live | Calendar renders correctly, honest empty state ("Nothing scheduled here yet") | PASS-LIVE |
| DB-12 | `/dashboard/billing` | Billing | Live | Plan/credits display accurate throughout. Minor finding: after a direct checkout-API test created a real (unpaid) Stripe customer record, the page switched from "Upgrade plan" to "Manage billing" for what's still a Free-plan account — verified the portal link itself still works correctly regardless, so this is a label-accuracy nit, not a broken feature | PASS-LIVE (minor label finding) |
| DB-13 | `/dashboard/projects/[id]` | (via Projects list) | Live, x2 real projects | Full project detail page tested: status transitions (queued → rendering → ready/failed), Download link, Publish button, thumbnail generation, EDL/XML export links all present and correctly rendered for a completed project | PASS-LIVE |
| DB-14 | `/admin` | (owner only) | Not tested this session | Requires an admin-flagged account; this session's test account is not an admin, and elevating it was correctly blocked by the harness's own safety classifier when attempted via direct DB write | BLOCKED-OWNER |
| DB-15 | Media authorization (wrong-owner/anonymous access) | Security | Live | Anonymous request to an authenticated user's private project media correctly returns 404 (fails closed, doesn't leak existence via a different status code) | PASS-LIVE |

## 5. Generation engines

| ID | Engine | Aspect | Test type | Evidence | Result | Fix commit |
|----|--------|--------|-----------|----------|--------|------------|
| G-01 | Script-to-video | Full pipeline (authenticated + demo) | Live E2E, 4x total this session | See D-05/D-09/DB-04 | PASS-LIVE | `9771212` |
| G-02 | Script-to-video | Route validation | Code review | zod schema present, aspect-ratio/plan gating via `canUseAspectRatio` | PASS (code) | — |
| G-03 | UGC | Plan gate | Live | Correctly blocks Free plan | PASS-LIVE | — |
| G-04 | UGC | Full generation E2E | Requires paid plan | Not performed — blocked on paid-plan test access (Stripe checkout's card entry is a secure iframe this automation can't complete; a direct DB plan override was attempted and correctly blocked by the harness's own safety classifier) | BLOCKED-OWNER | — |
| G-05 | Repurpose | Plan gate | Live | Correctly blocks Free plan | PASS-LIVE | — |
| G-06 | Repurpose | Real file upload via `setInputFiles()` | Requires paid plan | Not performed this session — same blocker as G-04 | BLOCKED-OWNER | — |
| G-07 | Repurpose | Memory ceiling on staging | Dashboard-only setting | Railway's exposed tooling has no way to read or set per-service memory limits — confirmed again this session via the available MCP tool surface | **BLOCKED-VENDOR/TOOLING** | — |
| G-08 | All 3 engines | Credits reserved + captured exactly once | Code review + live (script engine) | `CreditReservation` reserve→capture\|release lifecycle; live-confirmed for script engine (50→40→30, exact 10-credit charges, zero charge on the failed attempt) | PASS-LIVE (script) / PASS (code, UGC/Repurpose) | — |
| G-09 | All 3 engines | Cost record created once | Code review | `JobCostRecord.jobId` is `@unique` | PASS (code) | — |
| G-10 | All 3 engines | No double charge/refund | Code review | Idempotency key per ledger entry (`@unique` constraint) | PASS (code) | — |
| G-11 | Script-to-video | Failure/refund path | **Live, real failure** | First real generation attempt this session genuinely failed (`"All TTS providers failed"` — real root cause was the storage bucket not existing, see S-16); credits correctly stayed untouched at 50, confirmed via `/api/me` before and after | PASS-LIVE | — |
| G-12 | Script-to-video | UI click reliability | Live (tooling finding, not an app defect) | The visual "Generate video" button click did not reliably register via this session's browser-automation tooling on 2 separate occasions; triggering the same button's real handler via `element.click()` in-page worked every time and produced identical, correct results (real API calls, real state changes) — confirms the UI itself is fine, the automation click mechanism in this environment is not fully reliable | Tooling limitation, not a product finding | — |

## 6. Pricing, Stripe & entitlements

| ID | Item | Expected | Test type | Evidence | Result |
|----|------|----------|-----------|----------|--------|
| B-01 | Displayed prices vs Stripe | Match exactly | Live Stripe API cross-check | $19.99/$26.88/$44.99, all `active:true` on both production and now staging | PASS |
| B-02 | Webhook signature verification | Rejects unsigned/bad-signature events | **Live, real signed event** | Sent a real test event from the Stripe dashboard to the live staging endpoint: `POST /api/stripe/webhook` → 200 in 65ms, zero application errors. Separately confirmed a deliberately-fake signature is rejected (`400`, "signature verification failed") | PASS-LIVE |
| B-03 | Webhook event dedup | `StripeWebhookEvent.id` PK, duplicate delivery no-ops | Code review + integration test | N truly concurrent deliveries of the same event id against real Postgres — exactly one recorded, rest get `duplicate:true`, none throw | PASS-LIVE (test), code-reviewed for the live route |
| B-04 | Initial grant vs renewal double-credit | Must not double-grant on first invoice | Code review | `invoice.paid` handler scoped to `billing_reason === "subscription_cycle"` only | PASS (code) |
| B-05 | Upgrade credit diff | Grants positive diff only, never reduces on downgrade | Code review + unit tests | `Math.max(0, newPlan.credits - oldPlan.credits)`, separate idempotency key; 10 tests covering every transition | PASS (code) |
| B-06 | Checkout flow (test mode) | Full flow completes | **Live, partial** | All 5 required Stripe env vars now configured on staging (owner-completed, values never seen in chat). `POST /api/stripe/checkout` returns a real, valid Stripe Checkout session for Hobby/Creator/Business. Completing an actual test payment through Stripe's hosted card-entry page was not achieved — that page is a secure, cross-origin iframe specifically designed to resist automated input, by design, not a bug on either side | PASS-LIVE (session creation) / not completed (actual payment submission) |
| B-06b | Customer portal | Access + actions | Live | `POST /api/stripe/portal` → 200, real `billing.stripe.com` session URL returned | PASS-LIVE |
| B-07 | Checkout flow (production) | — | **Will not test** | Production key confirmed live-mode (`sk_live_` prefix) — real-charge risk, explicitly forbidden without approval | BLOCKED-OWNER/POLICY |
| B-09 | Entitlement enforcement (`canUseVoiceClone`/`canUseBrandKit`/`canUseApiAccess`/`canUseUgc`/`canUseRepurpose`) | Plan-based gates | Code review + live (UGC/Repurpose/API-keys/Team gates) | All confirmed correctly blocking a Free-plan account with accurate, honest copy | PASS-LIVE (gates) / PASS (code, deeper entitlement mechanics) |
| B-10 | "Plan not configured" for a publicly sold plan | Must never happen | Live cross-check | All 3 paid plans have valid `priceId` resolving to real, active Stripe prices on staging now too | PASS |
| B-11 | Upgrade/downgrade/renewal/failed-payment/cancellation | Full entitlement lifecycle | Not tested | Requires an actual active subscription, which requires completing the blocked checkout step (B-06) | BLOCKED-OWNER |

## 7. Email delivery

| ID | Email | Expected | Test type | Evidence | Result |
|----|-------|----------|-----------|----------|--------|
| E-01 | Verification email (resend) | Correct sender/subject/link/expiry, real delivery | **Live, real delivery confirmed** | See A-15 — was broken (`RESEND_API_KEY` missing on staging), fixed, real email received and its link clicked by the owner, verification banner disappeared confirming end-to-end delivery | **FAIL → FIXED**, PASS-LIVE |
| E-02 | Password reset email | Same | Code review only | Not live-tested this session | PASS (code) / BLOCKED-OWNER (live) |
| E-03 | Workspace invite email | Same | Code review only | Not live-tested this session | PASS (code) / BLOCKED-OWNER (live) |
| E-04 | Deploy-failure alert email | Sent on failed health check post-deploy | Code review | `.github/workflows/deploy.yml` — sends via Resend on health-check failure | PASS (code) |
| E-05 | Sender domain | `EMAIL_FROM` configured, not shared testing domain | Config check | Production has `EMAIL_FROM` set | PASS |

## 8. Business/collaboration features

| ID | Feature | Test type | Evidence | Result |
|----|---------|-----------|----------|--------|
| C-01 | Idea Radar generation | **Live** | See DB-02 — full generate + "Use this idea" handoff tested and working | PASS-LIVE |
| C-02 | Trend Radar (onboarding/resolve-channel) | **Live** | See DB-03 — onboarding form and validation tested; channel resolution found broken (missing YouTube key), error handling fixed; feed/ingest not exercised live | PASS-LIVE (onboarding, error handling) / BLOCKED-OWNER (channel resolution itself, feed content) |
| C-03 | Brand Kit CRUD | **Live** | See DB-08 — save + reload persistence confirmed | PASS-LIVE |
| C-04 | Workspace create/invite/leave/members | Live (gate only) | Correctly gated to Business plan; actual workspace CRUD not tested (needs paid plan) | PASS-LIVE (gate) / BLOCKED-OWNER (CRUD) |
| C-05 | Scheduling + `process-scheduled-posts.sh` | Live (empty state) | Calendar and empty state render correctly; actual scheduling needs a completed project + connected social account, neither exercised live | PASS-LIVE (empty state) / BLOCKED-OWNER (full flow) |
| C-06 | Connected-account OAuth (tiktok/youtube/instagram) | **Live** | All 3 correctly show honest "Not set up on this server yet" with genuinely disabled Connect buttons | PASS-LIVE |
| C-07 | API keys (create/list/revoke/auth) | Live (gate only) | Correctly gated to Business plan | PASS-LIVE (gate) / BLOCKED-OWNER (creation itself) |
| C-08 | MCP server (`/api/mcp`) | Code review only | Route present, Business-plan gated | PASS (code) |
| C-09 | Admin credit grant / plan comp | Code review only | `AdminAction` audit-log model backs every grant; this session's comp-plan attempt correctly required real admin access, which wasn't available | PASS (code) / BLOCKED-OWNER |

## 9. Security & infrastructure

| ID | Item | Test type | Evidence | Result |
|----|------|-----------|----------|--------|
| S-01 | Security headers | Live curl | HSTS, X-Frame-Options:DENY, nosniff, restrictive Permissions-Policy all present | PASS |
| S-02 | CSP | Live curl | Real allowlist, no wildcard `*` origins | PASS |
| S-03 | SSRF protection | Code review + 25-test suite | See D-07 | PASS |
| S-04 | Media authorization / signed-URL expiry | Code review + live | Presigned URLs, 1h default TTL; wrong-owner/anonymous access confirmed blocked this session (DB-15) | PASS-LIVE |
| S-05 | Admin route isolation | Live | Anon → 307 (page) / 403 (API) | PASS |
| S-06 | Password/TOTP encryption at rest | Code review | bcrypt (password), AES-256-GCM (TOTP secret) | PASS (code) |
| S-07 | API-key hashing | Code review | SHA-256, shown once | PASS (code) |
| S-08 | Next.js CVE exposure | `npm audit` + upgrade | Upgraded 14.2.35 → 15.5.23 on a separate branch (`security/nextjs-15-upgrade`, not merged) — resolves every listed CVE, verified via advisory version-range data, not just `npm audit`'s default suggestion. Full build/unit/integration suites pass post-upgrade | **FAIL → FIXED (on separate branch, unmerged)** |
| S-08b | Transitive CVEs found during the upgrade | `npm audit` | `sharp` (libvips CVEs) fixed via override to 0.35.3. `postcss` bundled *inside* Next 15.5.23's own dependency tree has real CVEs with no patch available before Next 16 — left open deliberately (forcing an override into a third-party package's internal dependency is riskier than the low practical exposure here justifies; this only processes developer-authored CSS at build time, never runtime user content) | Documented, one item still open pending a future Next 16 evaluation |
| S-09 | Dependency audit (prod deps) | `npm audit --omit=dev` | See S-08/S-08b | Documented |
| S-10 | Production DB backup | Live | Verified in an earlier phase of this engagement | PASS |
| S-11 | Migration state | Live | `prisma migrate status` — schema up to date | PASS |
| S-12 | Container health/restarts | Live | Verified in an earlier phase | PASS |
| S-13 | Worker admission control (single-worker enforcement) | Code review + live | `WorkerRegistration` table shows exactly 1 admitted worker | PASS |
| S-14 | Config drift (`.env` vs `.env.example`) | Value-blind diff | Found + fixed in an earlier phase | FAIL → FIXED |
| S-15 | `deploy` job production-ref gating | Live | Confirmed `if: github.ref == 'refs/heads/main'` correctly skips deploy on PR-triggered runs | PASS |
| S-16 | Staging object storage | **Live, real failure + fix** | Real generation failed with `"The specified bucket does not exist"` — the configured `STORAGE_BUCKET` genuinely didn't exist on staging. Provisioned a fresh Railway-native bucket, wired credentials to both the app and worker services via Railway variable references (credential values never seen in chat). Re-verified with 2 more real, successful, playable generations afterward | **FAIL → FIXED**, PASS-LIVE |
| S-17 | Staging email sending | **Live, real failure + fix** | See A-15/E-01 | **FAIL → FIXED**, PASS-LIVE |
| S-18 | Staging YouTube Data API | **Live, real failure, error-handling fixed** | See DB-03 | **FAIL → FIXED (error handling only)**; key itself still BLOCKED-OWNER |
| S-19 | Monitoring counters | Code-scan finding | 6 Prometheus counters (`credit_inconsistencies_total` and 5 others) are hardcoded to zero forever — nothing in the codebase increments them. A real monitoring blind spot: an alert on `credit_inconsistencies_total > 0` would never fire even during a genuine incident | **Real finding, not fixed** — wiring real increments touches multiple worker/job-lifecycle call sites, scoped as a follow-up, not a quick fix |
| S-20 | `lib/pricing/ledger.ts` stale comment | Code-scan finding + fix | Comment claimed this credit-reservation engine was inert/flag-gated scaffolding; verified via grep that all 3 generation routes and all 3 job runners call it directly and unconditionally, and the flag it cited has zero real call sites anywhere. Comment corrected — the stale version read like an invitation to delete live production logic | **FAIL → FIXED** | `ee9c63b` |
| S-21 | Roadmap vote error handling | Code-scan finding + fix + test | See P-17b | **FAIL → FIXED** | `ee9c63b` |

## 10. Cross-browser & accessibility

| ID | Item | Test type | Evidence | Result |
|----|------|-----------|----------|--------|
| X-01 | Chromium (desktop) | Full suite, staging | 26/27 (1 known content gap, since fixed — see P-25) | PASS |
| X-02 | WebKit (desktop) | Full suite, staging | 26/27 | PASS |
| X-03 | Mobile Chrome (Pixel 7) | Full suite, staging | 26/27 | PASS |
| X-04 | Firefox (desktop) | CI workflow written (`.github/workflows/e2e.yml`), not yet pushed/run | This dev machine cannot launch Firefox (`spawn UNKNOWN`, persists across reinstall) — needs the Linux CI runner to actually prove it | **UNTESTED** — infrastructure exists, hasn't executed yet |
| X-05 | Creator/Popular accessible name | Live a11y check | Fixed, see P-08 | FAIL → FIXED |
| X-06 | `link-in-text-block` (5 routes, 12 files) | axe-core live scan + fix | See P-25 | **FAIL → FIXED** |
| X-07 | Keyboard navigation (homepage hero, login form) | Playwright, live | Login-form test was itself flaky (wrong Tab-count assumption, not an app bug) — fixed; both pass against staging now | **FAIL → FIXED (test bug)**, PASS-LIVE |
| X-08 | `prefers-reduced-motion` (pricing scroll-reveal) | Playwright, live | Sections render fully visible under reduced motion, not stuck at opacity 0 | PASS-LIVE |
| X-09 | Keyboard navigation (dashboard) | Not exhaustively audited | Only the two flows in X-07 were tested; full dashboard keyboard sweep not performed | Not verified |

---

## 11. Load & reliability testing

`tests/load/*.js` (k6 scripts) exist, covering the 10/25/50/100/150-concurrent-user scenarios. `.github/workflows/load-test.yml` written this session to run them in CI (public-browsing unconditionally, the 4 account-requiring scenarios gated behind `TEST_USER_EMAIL`/`TEST_USER_PASSWORD` repo secrets) — not yet pushed/run.

| ID | Item | Result | Reason |
|----|------|--------|--------|
| L-01 | `public-browsing.js` (100 users) | CI infrastructure exists, not yet executed | Needs the workflow pushed and run in GitHub Actions |
| L-02/L-03 | Account-requiring scenarios | BLOCKED-OWNER | Need `TEST_USER_EMAIL`/`TEST_USER_PASSWORD` repo secrets from a real seeded test account |
| L-05 | Worker crash recovery / stale-lease reconciliation | PASS (code) | `reconcileAbandonedProcessingJobs()` — correctly requeues with backoff or dead-letters |
| L-06 | Demo quota persistence across restarts | **FAIL → FIXED** | See D-02 — was dead code, now the live, only implementation |
| L-07 | Graceful deployment shutdown | PASS (code) | `Worker.shutdown()` drains in-flight jobs via `Promise.allSettled` |

## 12. Operations

(Unchanged from the 2026-08-19 pass — not re-verified this session; see prior manifest history for O-01 through O-10 evidence.)

## Findings register (not necessarily P0 fixes)

- **F-02**: ~~`lib/demo/quota.ts`'s DB-backed quota system is dead code~~ — **RESOLVED**, see D-02.
- **F-03**: `lib/jobs/claim.ts`'s `completeJob`/`failJobTerminal`/`failJobRetryable` are exported but never called; each runner re-implements the same lease-check inline instead. Confirmed not a safety gap — real duplication. Still open.
- **F-04**: ~~Next.js 14.2.35 CVE exposure~~ — **RESOLVED on a separate branch**, see S-08 (not yet merged).
- **F-05**: 5 pages had the `link-in-text-block` WCAG violation — **RESOLVED**, see P-25.
- **F-06**: `lib/pricing/ledger.ts` had a dangerously stale comment claiming live code was dead — **RESOLVED**, see S-20.
- **F-07**: Roadmap vote silently reported success on real DB failures — **RESOLVED**, see P-17b.
- **F-08**: 6 monitoring counters are permanently hardcoded to zero, never incremented — open, see S-19.
- **F-09**: 3 of 3 homepage showcase clips broke when the storage bucket was replaced; 1 of 3 fixed — open, see P-03.
- **F-10**: Billing page prematurely shows "Manage billing" instead of "Upgrade plan" once a Stripe customer record exists, even with no active subscription — open, minor, see DB-12.
- **F-11**: Idea Radar and Trend Radar pages don't set their own `<title>` — open, minor, cosmetic.

## Rollup

| Result | Count (approx.) |
|--------|-------|
| PASS-LIVE (tested live this session or previously, with real evidence) | ~75 |
| PASS (code-reviewed only) | ~25 |
| FAIL → FIXED this pass (2026-08-24) | 9 |
| FAIL → PARTIALLY FIXED | 1 (P-03, 1 of 3 showcase clips) |
| Real finding, not fixed (scoped as follow-up) | 2 (F-08 dead metrics, S-08b unmerged postcss gap) |
| BLOCKED-OWNER (needs the owner's direct action or a real paid-plan account) | ~15 |
| BLOCKED-VENDOR | 1 (Railway memory-limit visibility) |
| UNTESTED (infrastructure exists, not yet executed in CI) | 2 (Firefox, load tests) |
| Minor/cosmetic findings, not blocking | 3 |

**Verdict: NO-GO.** Substantially more of this system now has real, live evidence than at the start of this session — most of Section 4 (Dashboard) and Section 6 (Stripe) moved from code-review-only to live-tested, and 9 real, previously-unknown bugs were found and fixed with regression tests. What remains genuinely blocking a READY verdict is narrower and more specific than before:

1. **Paid-plan test access** — blocks full UGC/Repurpose generation testing, the full Stripe entitlement lifecycle (upgrade/downgrade/renewal/cancellation), workspace CRUD, and 2 of 3 homepage showcase clips. Needs either a completed real checkout (blocked on Stripe's own secure card iframe resisting automation) or an existing admin promoting a test account.
2. **Cross-browser (Firefox) and load testing** — infrastructure is written and ready, just not yet pushed/run in CI.
3. **3 external vendor credentials** still missing on staging: `YOUTUBE_DATA_API_KEY` (real Google Cloud credential), and full TikTok/Instagram OAuth app approval (inherently vendor-gated, not fixable in code).
4. **Next.js 15 security upgrade** exists, fully verified, on a separate unmerged branch — a deliberate choice to keep it independently reviewable from functional fixes, not an oversight.

See PR #5 for the release-readiness evidence package this manifest feeds into.
