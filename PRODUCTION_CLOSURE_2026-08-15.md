# Clipforge — Final Post-Deployment Closure

**Date:** 2026-08-15 (continuing directly from the Production Security and
Stabilization pass). No secret values appear anywhere below.

**Verdict: CONDITIONAL.** Everything checked in this pass passed — no known
defect, no failed verification. It isn't a higher verdict only because two
items are genuinely, necessarily incomplete: a 48-hour real-time observation
window (real time cannot be compressed) and an actual controlled launch
(requires real users, an owner action, not something to simulate). See §8.

---

## 1. Credential rotation — verified working

Every check ran against the *current* (owner-rotated) value, without the value
ever appearing in output, a file, or a commit.

| Credential | Verification | Result |
|---|---|---|
| Stripe secret key | `GET /v1/balance` (read-only) | `200`, valid |
| Stripe webhook secret | Sent a real signed test event (`stripe.webhooks.generateTestHeaderString`) to the live production endpoint | `200 {"received":true}` |
| Resend API key | Sent one controlled test email, then queried Resend's own delivery status | `last_event: delivered` |
| Groq API key | One minimal chat-completion request | `200`, real response |
| YouTube Data API key | One minimal `videos.list` call | `200`, real response |

**Old credentials revoked**: not independently verifiable from this session —
I no longer hold the old values (deliberately, from the prior pass's
redaction) and no provider exposes a "list my keys" API for this key type.
Confirm directly in each dashboard's key list.

**Separation confirmed**: Stripe uses a `sk_test_...` key on staging vs.
`sk_live_...` on production — different key types, not just different
values. Resend/Groq/YouTube are **not configured on staging at all** (staging
uses mocked/free-tier providers), so there's nothing shared to leak between
environments for those three.

**No plaintext remains**: re-scanned `.claude/settings.local.json` (0 credential
patterns), the full scratchpad directory (0 real matches — 3 initial hits were
confirmed false positives, SQL identifiers like `"...Score_videoId..."`
coincidentally matching a loose regex, not credentials), and confirmed git
status clean throughout.

---

## 2. Internal media secret — separated

You were right that staging and production shared one `INTERNAL_MEDIA_SECRET`.
Fixed: generated two independent high-entropy values, set one on production
(app + worker, via the shared `.env`) and a different one on staging (app +
worker, via Railway variables), redeployed both, and verified bidirectionally
— by hash comparison only, values never displayed:

| Check | Result |
|---|---|
| Production's own secret, against a real private production video | `200` |
| Staging's secret presented to production (cross-environment) | `404` |
| Staging's own secret, against a real private staging video | `200` |
| Production's secret presented to staging (cross-environment) | `404` |
| No secret / no session, either environment | `404` |

One real gap found and fixed along the way: staging's Railway services were
still tracking the old `scale/100-user-readiness` branch at a stale commit
(`dd03783`, from *before* the migration/deploy/security work), never
auto-updated after that branch was merged into `main`. Fast-forwarded the
branch to match `main` and confirmed staging redeployed to the current
commit before running the tests above.

---

## 3. Backup restore — contradiction resolved with a fresh test

The earlier "49 vs 40" discrepancy wasn't a data problem — it was an
unstated schema-scoping difference. Definitive numbers now, from a **fresh
backup taken after the migration**, restored into a new isolated disposable
container (never touching production), verified, and torn down completely:

| | |
|---|---|
| Total tables in the dump | 52 |
| `public` schema (Clipforge's own tables) | **43** = 40 original + `WorkerRegistration` + `DemoQuota` + `_prisma_migrations` (the migration-history table itself, which didn't exist before this validation phase's item 1) |
| `neon_auth` schema | **9** — a Neon-platform-managed schema, unrelated to Clipforge's own Prisma schema |
| Restoration | 52/52 `CREATE TABLE`, 52/52 `COPY` succeeded; the only errors (55, all `role "neon..." does not exist`) are expected artifacts of restoring a Neon dump into vanilla Postgres |
| Row counts | `User`: 15, `Project`: 28, `Job`: 28, `WorkerRegistration`: 6, `_prisma_migrations`: 2 (both migrations, `applied=true`) |
| New `Job` columns | All 15 present with correct defaults, confirmed via `\d "Job"` |
| Prisma connectivity | The real generated **typed** Prisma Client (not just raw SQL) connected and queried a genuine row with real lease-fencing field values |
| Integrity | Zero orphaned `Job` rows (by User or Project), zero orphaned `Project` rows, zero stale-lease `processing` jobs |

---

## 4. Deployment approval — configured and proven live

The `production` GitHub Environment existed but had zero protection rules
(the owner action from the prior report hadn't been done yet). Configured a
required-reviewer rule naming the repo owner, then proved it with two real
deployments, not just the API's static config:

- Triggered a `workflow_dispatch` test deploy: `build-check: success` →
  **`deploy: waiting`** — the pending-deployment API confirms the exact
  reviewer required and that it is genuinely paused, not proceeding on its
  own. **Left it paused** rather than approving it myself — self-approving
  would prove nothing about a human gate existing.
- Pushed the monitoring-extension commit right behind it: its `deploy` job
  also entered `waiting` — and **the concurrency mechanism then cancelled
  the older, still-pending test deployment automatically**, live proof (not
  just intended behavior) that an older commit can't finish after and
  overtake a newer one.
- PR-cannot-deploy: structural (the `if:` condition has no branch that a
  `pull_request` event can satisfy) plus historical evidence from PR #1's
  own checks (`deploy: skipping`).
- Docs-only-skips and code-requires-CI-gates: re-confirmed unchanged from
  the prior pass.
- Emergency bypass: added a six-condition policy to the runbook (active P0
  only, minimal reviewed patch, CI still required, immediate owner
  notification, rollback ready, post-incident report) and **applied it to
  this session's own next commit** — the monitoring extension had no active
  P0 behind it, so it went through the normal gate rather than being
  SSH'd onto the VPS directly, even though that would have been faster.

**Currently sitting paused, for you to resolve**: the monitoring-extension
deployment (and now instead the follow-up evaluation-script commit tracking
right behind it, per the same concurrency behavior) is waiting for approval
in the GitHub Actions UI. Approving it is a normal deploy of already-tested,
already-committed code; rejecting it just leaves production on its current
commit. Either is fine — it's genuinely your call, not mine.

---

## 5. Monitoring — implemented and delivery-proven, not yet live

`scripts/watchdog.sh` now checks all nine conditions:

| Condition | Status |
|---|---|
| Health-check failure | Already existed |
| Worker disappearance | Already existed (container-status loop) **+ new**: heartbeat-staleness check catches a *hung* worker, not just a crashed one — a documented, previously-accepted gap |
| Queue age | New — alerts past 15 minutes oldest-queued |
| Job failure spike | New — alerts past 3 failures/hour |
| Credit inconsistency | New — the exact atomicity check from the observation snapshot |
| Database exhaustion | New — connection count vs. `max_connections`, alerts at 80% |
| Worker memory pressure | New — alerts approaching the 4GB compose limit |
| Media-download failures | New — 5xx only on `/api/media` (a 4xx is often *correct* now, post-authorization-fix) |
| Stripe webhook failures | New — signature/processing errors from app logs |

**Test alert, real delivery proven**: ran the new script's `--test-alert`
mode from a temporary copy on the VPS (not the live cron path, since that
deploy is correctly pending approval per §4) and confirmed via **Resend's
own send-log API** — not just the script's exit code —
`"last_event":"delivered"`.

**Honest status**: the code is complete, syntax-checked, and the alert path
is proven end-to-end. It is **not yet running on the live 5-minute cron
loop** — that requires the pending deployment in §4 to be approved. Not
calling this "fully operational" until that happens.

---

## 6. Real observation window — honestly incomplete

Checked actual elapsed time against real, independently-verified server
timestamps (the health endpoint's own timestamp field and the VPS's `date -u`,
agreeing) rather than assuming: since the prior pass's last snapshot, **under
90 minutes of real time has elapsed, not 48 hours.** Stated exactly as that —
no rounding up, no implying more time passed than did.

What real time *did* elapse stayed clean: 0 restarts, 0 job failures, 0
credit inconsistencies, 1 real Stripe webhook processed successfully.

**Follow-up mechanism, tested and working**: `scripts/evaluate-observation-window.sh`
(committed) pulls watchdog history, container restart counts, and precise
windowed database metrics directly from production, read-only. Already run
against the real ~70-minute window elapsed so far — output above. Run it
again after 48 real hours have genuinely passed:

```bash
./scripts/evaluate-observation-window.sh "2026-08-15T14:52:00Z"
```

(Omit the end timestamp and it uses the actual current time — so this exact
command, run whenever you actually run it, evaluates from the pass's true
start to that moment.)

---

## 7. Controlled-launch measurement framework — prepared, not executed

No real controlled-user cohort exists yet — checked directly rather than
assumed: 15 total users, all on the free plan, 7 with non-internal/non-demo
email addresses (early testers from development, not a controlled launch).
Real baseline data pulled from actual production activity so far (mixed
testing + whatever organic use has happened, not a clean cohort — stated as
such, not presented as launch results):

- Job outcomes (30d): 12 done, 16 failed — **includes this session's own
  deliberate testing**, not representative of a real user's experience.
- Real render cost/duration: 5 jobs via Groq (free tier), avg 90.3s.
- 0 paid conversions so far.

**Measurement plan, ready for when real users start** (each maps to a
specific, already-written query against real tables — `User`, `Project`,
`Job`, `CreditReservation`, `AdminAction` for refunds/comps, Stripe's own
dashboard for conversion/refunds):

| Metric | Source |
|---|---|
| Signup completion | `User` rows created vs. registration-page visits (needs basic funnel tracking — not currently instrumented) |
| First-video completion | First `Job.status = 'done'` per `User`, time from `User.createdAt` |
| Time to first successful video | `Job.completedAt - Job.createdAt` for each user's first successful job |
| Generation success rate | `Job` status distribution, scoped to real (non-demo, non-internal) users |
| Average real cost per video | `JobCostRecord`, scoped the same way, using real (non-mock) provider data |
| Support requests | Inbox at `support@forgecut.app` (needs the email-forwarding fix `OPERATIONS.md` already flagged as outstanding) |
| Refunds | `AdminAction` rows of that type, plus Stripe's own refund list |
| Upgrade conversion | `User.plan` changes correlated with Stripe subscription events |
| User feedback | Not currently collected anywhere structured — worth a lightweight mechanism (even just "reply to this email") before real users arrive |

**Not done, and not fabricated**: no controlled launch has actually run.
Recruiting 10–20 real users is a business/outreach action outside what this
session can do or simulate. This section is the plan, not the result.

---

## 8. Verdict and remaining owner actions

**CONDITIONAL.** Every technical check in this pass — credentials, secret
separation, backup integrity, deployment gating, monitoring code and alert
delivery — passed with real, verified evidence and zero fabrication. What's
missing is real-world time and real users, neither of which a chat session
can manufacture. That's exactly what keeps this from being a clean "ready."

**Remaining owner actions, in order:**
1. Resolve the paused deployment in GitHub Actions (approve to ship the
   monitoring extension, or reject to leave production as-is) — either is a
   legitimate choice.
2. Confirm the four old credentials show as revoked in their respective
   provider dashboards (Stripe, Resend, Groq, Google Cloud Console).
3. Let real time pass, then run `./scripts/evaluate-observation-window.sh`
   with this pass's start timestamp once 48 real hours have elapsed.
4. When ready, recruit the 10–20 controlled users and point them at
   production — the measurement queries in §7 are ready to run against
   whatever real data comes back.
5. Fix `support@forgecut.app` email forwarding in Porkbun (flagged in
   `OPERATIONS.md`, still outstanding, and now a prerequisite for §7's
   support-request metric to mean anything).

Do not treat this as public-launch-ready until 3 and 4 both have real
results — that's your call to make once they do, not mine to declare now.
