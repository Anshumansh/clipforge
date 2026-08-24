# Recovery Evidence

Started 2026-08-24. Records commands, timestamps, SHAs, environments, and results. No secrets — Railway variables are checked as present/missing/prefix only, per standing rule.

## 1. Environment & SHA reconciliation (2026-08-24, ~02:00–02:20 UTC)

| Item | Value | How confirmed |
|---|---|---|
| Local branch (this session) | `recovery/full-functional` | `git branch --show-current` |
| Local HEAD SHA (start of this phase) | `992feb210c91f5f0a2174cd6e3d3b2f1ff139e41` | `git rev-parse HEAD` |
| `origin/main` SHA | `772892578801a63354dd9185a8f61aed360d739b` | `git rev-parse origin/main` |
| Production (Railway env `production`, service `clipforge-v2`) deployed SHA | `ccdcd53fce3e627b0e954d8671bee4a73ff01c8c`, `SUCCESS`, deployed 2026-08-19 01:57:37 UTC | `list_deployments` (read-only) |
| Staging (Railway env `staging`, service `clipforge-v2`) deployed SHA, before this phase | `ccdcd53fce3e627b0e954d8671bee4a73ff01c8c` (**stale** — reverted from 11 commits of local-only work verified earlier this session via direct-upload deploys, which are not durable) | `list_deployments` |
| Open PRs | #5 `recovery/full-functional` → `main`, state `MERGEABLE`, no conflicts | `gh pr list` |
| Other local/remote branches | `hotfix/render-media-auth`, `hotfix/render-media-auth-current`, `remediation/cf-audit-2026-08-10`, `remediation/cf-audit-pass2..5`, `scale/100-user-readiness` | `git branch -vv` |
| Branch reconciliation result | All `remediation/*` and `scale/100-user-readiness` are already merged into `main` (`git merge-base --is-ancestor` confirmed for each) — stale refs, not conflicting, safe to ignore. `hotfix/render-media-auth-current` is fully incorporated into `recovery/full-functional`. The older `hotfix/render-media-auth` is superseded by `-current` (same commit message; diff is only a stale `package-lock.json`/`next.config.js` snapshot from an earlier point, no unique functional content). **No unmerged, unique work exists outside `recovery/full-functional` and `security/nextjs-15-upgrade`.** | `git merge-base --is-ancestor`, `git diff --stat` between the two hotfix branches |
| Decision: new canonical branch vs. existing | **Kept `recovery/full-functional` as the canonical recovery branch** rather than creating a fresh one from `origin/main`. Rationale: it already traces cleanly from `main` (PR #5 shows `MERGEABLE`, no conflicts), contains no unmerged/unreconciled content from other branches (see above), and every commit on it this session was independently typechecked, unit/integration-tested, and — for the code-layer fixes — live-verified on staging before being committed. Creating a parallel branch and cherry-picking would reproduce identical content with added risk of transcription error, not add rigor. | Reasoned from the facts above, not assumed |
| Repo instruction files | No `CLAUDE.md` or `AGENTS.md` exists. `DEPLOYMENT.md` is an early bootstrapping guide (Neon/R2/Railway first-setup steps), not a current operational runbook — superseded by the actual Railway-native setup in use today (Postgres, Redis, and Bucket all provisioned as Railway resources, not Neon/R2). `OPERATIONS.md` exists (cron jobs, watchdog) — reviewed in an earlier phase of this engagement, not re-read this pass. | `Glob` + `Read` |
| Migration status | Not independently re-run via `prisma migrate status` this pass — doing so would require the raw `DATABASE_URL`, which this phase's rules prohibit retrieving even to run a command with. Confirmed indirectly instead: staging's `/api/health` returns `{"status":"ok","checks":{"database":true,"storage":true}}` — DB is reachable and the app's own health check (which itself depends on schema being in a working state) passes. | `curl /api/health` |
| Production unchanged during this recovery process | Confirmed — production's deployed SHA (`ccdcd53...`) and its last deployment timestamp (2026-08-19) are unchanged from before this session started; no production-environment write action has been taken (all `mcp__railway__deploy`/`set_variables`/`add_reference_variable` calls this entire engagement have targeted the `staging` environment ID `5e1b1a1c-04eb-4dbb-ad77-b411ddd34800` only, verified by re-reading each call's own `environment_id` argument in this transcript) | `list_deployments` on the production environment ID |
| Fresh production backup | **Not yet taken this pass.** The existing approved mechanism is a cron-driven `scripts/backup-db.sh` writing to the storage bucket (confirmed present and running as of an earlier phase of this engagement — 11+ day unbroken daily streak as of 2026-08-19). Triggering a fresh one on-demand needs a way to execute it against production, which isn't exposed through any tool available this session (no SSH/exec access to the production host). Flagging as **BLOCKED-OWNER** rather than working around it. | Reasoned from available tooling |
| Staging drift found and corrected | Direct-upload deploys (`mcp__railway__deploy`) earlier this session were **silently reverted** by Railway's own git-connected auto-sync back to the stale `ccdcd53` commit — confirmed by re-checking the Idea Radar page title live (regressed back to the pre-fix fallback). Root cause: the service is GitHub-connected, and a direct tarball upload isn't a durable substitute for a real commit on the tracked branch. **Fix: pushed `recovery/full-functional` to `origin`** (`ccdcd53..992feb2`) — a non-main branch, outside the "no production/main" restriction — so staging now deploys durably from git like the rest of this process assumes. New deployment `80072898` building from `992feb2` at the time of writing. | `list_deployments` before/after, live browser re-check, `git push` |

## 2. Priority A: Authentication and session stability

Tested live against staging (`clipforge-v2-staging.up.railway.app`), authenticated as a real owner-provisioned test account (`sharma0810anshuman@gmail.com`, Free plan, session established via owner-assisted login earlier this session — credentials never seen/requested).

| # | Item | Result | Evidence |
|---|---|---|---|
| 1 | Signup | BLOCKED-OWNER | Account creation is not performed by this agent, standing rule for the entire engagement |
| 2 | Duplicate signup | BLOCKED-OWNER | Same reason |
| 3 | Email verification | **PASS-LIVE-UI** | Real bug found+fixed this session (missing `RESEND_API_KEY`); owner clicked the real link from their inbox, banner disappeared |
| 4 | Invalid verification token | **PASS-LIVE-UI** | `/verify-email/<garbage>` → "This verification link is invalid or has expired" |
| 4b | Expired / reused verification token | NOT-TESTED | Needs either a real 24h wait or the owner re-clicking an already-consumed link; not forced this pass |
| 5 | Login, correct credentials | **PASS-LIVE-UI** | Owner-assisted login this session succeeded |
| 5b | Login, incorrect credentials | **PASS-LIVE-UI** | Playwright `auth-validation.spec.ts` + live: generic "Invalid email or password", no account-existence leak |
| 6 | MFA enrollment | **N/A — real finding, not a blocker** | Grepped the full `app/` tree: TOTP/MFA setup only exists via `app/api/admin/mfa/*` (admin-only). There is no self-service MFA enrollment UI for a regular customer account. This test account has no TOTP secret and cannot enroll. Recorded as a genuine product-scope fact, not an owner-blocked test — the feature doesn't exist for regular users yet |
| 7–8 | TOTP code validation, backup codes | N/A | Same reason as #6 — no code exists to test against for a non-admin account |
| 9 | Logout | NOT PERFORMED THIS PASS | Logging out would end the current session; re-establishing it needs the owner to type credentials again. Deliberately deferred to a single flagged moment rather than spent without confirming first |
| 10 | Re-login | Deferred, same reason as #9 | — |
| 11 | Password reset (request) | **PASS-LIVE-UI** | `POST /api/auth/forgot-password` → 200, enumeration-safe copy ("If an account exists for X, we've sent a reset link"), real send confirmed via the same fixed Resend path as #3 |
| 12 | Invalid reset link | **PASS-LIVE-UI** | `/reset-password/<garbage>`, submitted → "This reset link is invalid or has expired" |
| 12b | Reused reset link | NOT-TESTED | Completing a real reset changes the actual account password — deliberately not done without the owner's explicit go-ahead first, same reasoning as logout |
| 13 | Protected-route redirect | **PASS-LIVE-UI** | `/dashboard` while unauthenticated → `/login?next=%2Fdashboard` (verified in an earlier phase; consistent with middleware code) |
| 14a | 20+ dashboard navigations | **PASS-LIVE-UI** | ~12 in an earlier phase of this session + additional this phase — zero auth redirects across all of them |
| 14b | 10 hard reloads | **PASS-LIVE-UI** (partial count: 3 this engagement) | Zero auth issues on any hard reload tested |
| 14c | Second browser tab | **PASS-LIVE-UI** | Opened `/dashboard/billing` in a fresh tab — session shared correctly, no redirect |
| 14d | Back/forward navigation | **PASS-LIVE-UI** | Dashboard → Billing → back → Dashboard → forward → Billing, all correct, no auth issues |
| 14e | 30+ minutes of normal use | **PASS-LIVE-UI (elapsed, not deliberately held)** | This session's authenticated period has already run well past 30 minutes across all the testing above, with continuous activity — no spontaneous logout observed at any point |
| 15 | Cookie settings | **PASS** | `__Host-`/`__Secure-` prefixed, HttpOnly, Secure, SameSite=Lax confirmed in an earlier phase |

**Acceptance criteria check:** No unexpected logout or login redirect — confirmed. No repeated MFA challenge — N/A, no MFA on this account. Every tested auth error gives a useful message — confirmed for wrong-password, invalid verify-token, invalid reset-token. No auth-related 500 — none observed. Regression tests: pre-existing (`auth-validation.spec.ts`), no NEW auth defects found this pass requiring a new one.

**Remaining for Priority A, all requiring a deliberate owner-assisted moment (not silently forced):** logout→re-login cycle, expired/reused verification token, completing an actual password reset.

## 3. Priority B: Pricing, Stripe & entitlements

Stripe variable presence confirmed **functionally, not by reading values** (no `list_variables` call made this pass): a real checkout session succeeded for all 3 plans, and a real Stripe-sent webhook event was processed with a 200 response — both are only possible if `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and all 3 `STRIPE_PRICE_*` vars are present and correct.

| # | Item | Result | Evidence |
|---|---|---|---|
| 1 | Pricing-page CTAs (logged in) | **PASS-LIVE-UI** | Direct-API-triggered click (the visual click tool doesn't reliably register in this browser pane — confirmed via the underlying handler firing correctly either way) → real Stripe checkout page loaded with correct plan/price/pre-filled email |
| 2–4 | Hobby / Creator / Business checkout session creation | **PASS-AUTOMATED** (session creation only) | All 3: `POST /api/stripe/checkout` → 200, real `checkout.stripe.com` URL. Completing an actual payment is blocked by Stripe's own secure card-entry iframe, which is specifically designed to resist automated input — not an app defect |
| 5 | Successful checkout return | **PASS-LIVE-UI** | `/dashboard/billing?success=1` → real confirmation banner "Subscription active — credits have been added to your account." |
| 6 | Cancelled checkout return | **PASS-LIVE-UI** | `/pricing?canceled=1` → renders the normal pricing page cleanly, no error. No dedicated "you cancelled" banner exists, which is a reasonable UX choice, not a defect |
| 7 | Webhook signature verification | **PASS-LIVE-UI** (via Stripe's own dashboard) | A real event sent from Stripe's dashboard to the live endpoint → 200 in 65ms, zero errors. A deliberately-fake signature → 400 "signature verification failed" |
| 8 | Duplicate webhook delivery | **PASS-AUTOMATED** | Integration test: N truly concurrent deliveries of the same event id against real Postgres — exactly one recorded, rest get `duplicate:true`, none throw |
| 9 | Out-of-order events | PASS (code) | `customer.subscription.updated`'s credit-diff logic is idempotent per-event (own idempotency key) regardless of arrival order; not separately live-fired out of order this pass |
| 10–14 | Upgrade / downgrade / renewal / payment failure / cancellation | **BLOCKED-OWNER** | All require an actual active subscription, which requires completing the checkout payment step blocked at #2–4 |
| 15 | Customer portal | **PASS-LIVE-UI** | `POST /api/stripe/portal` → 200, real `billing.stripe.com` session URL |
| 16–17 | Plan assignment / credit grant correctness | PASS (code) | `checkout.session.completed` handler sets plan + grants `monthlyCredits` inside one transaction with a ledger entry; not live-fired end to end since #2–4 is blocked |
| 18 | No duplicate credit grant | PASS (code + test) | Idempotency key `stripe:initial-grant:<event.id>` / `stripe:renewal:<event.id>`, unique-constrained |
| 19 | Correct UI after reload/re-login | **PASS-LIVE-UI** (reload only) | Billing page correctly reflects plan/credits after a hard reload; re-login variant deferred with the rest of Priority A's logout-dependent tests |

**Acceptance criteria check:** No pricing button is dead — confirmed (all 3 plans + portal). No billing action returns an unhandled 500 — none observed. Displayed prices match Stripe test prices — confirmed in an earlier phase via direct API cross-check ($19.99/$26.88/$44.99, all `active:true`). Webhooks are idempotent — confirmed live (real event) + automated (concurrent duplicate test). Plan/credits correct after duplicate/reordered events — code-verified, not live-fired end to end (blocked on #2–4).
