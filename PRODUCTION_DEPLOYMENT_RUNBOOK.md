# Clipforge — Production Deployment Runbook: `scale/100-user-readiness`

Written 2026-08-15, Release Candidate Validation, item 8. **Plan only — nothing in this
document has been executed against production.** It exists so the actual deploy, when
approved, is a checklist rather than a live decision tree. Cross-references
`OPERATIONS.md` and `QUEUE_RECOVERY.md` rather than duplicating them — read those first
if anything here is unclear on *why*, not just *what*.

**Scope of this release**: queue-lifecycle hardening (lease-based claiming, worker
heartbeats, retry-with-backoff, dead-lettering, priority — see `QUEUE_RECOVERY.md`),
media-attempt fencing, cost-record idempotency, a demo-admission race fix (found by this
validation pass's own load testing, see item 9 below), and CI hardening. **This release
does not deploy a second worker, does not change the VPS/DNS/database/B2/webhooks, and
does not make multi-worker concurrency "verified safe"** — it makes the architecture
no longer *structurally* unsafe for it (`QUEUE_RECOVERY.md` §3), which is a prerequisite
`CAPACITY_MODEL.md` §4 identified, not the scaling work itself. `docker-compose.yml`
still runs exactly one `worker` service after this deploy.

---

## 0. What was validated before this runbook was written

Real evidence, not projected — see the final Release Candidate Validation report for
full detail. Summarized here only as the basis for "why this is believed safe":

- Migration reconciled against production's actual schema via read-only introspection;
  rehearsed on a disposable clone seeded with historical-shaped data — zero data loss,
  correct defaults on existing rows, idempotent re-run.
- Real CI (build, typecheck, unit tests, real-Postgres integration tests) green on the
  exact commit being deployed, gated so a PR event can never reach a deploy step.
- A live staging deployment (separate Railway project, not production) ran the real
  Docker images end-to-end: registration, login, dashboard, demo quota, script-to-video
  and UGC generation (both with real Remotion rendering against a mock AI provider),
  worker restart during in-flight processing, media download/playback, duplicate Stripe
  webhook delivery, authenticated metrics scraping.
- Load tested at 10/25/50/100/150 concurrent web sessions against six real endpoint
  categories, plus a real concurrent-submission atomicity check and a real Stripe
  webhook burst — see §5 below for what this does and doesn't say about production
  capacity specifically.
- A real concurrency bug (demo-job admission race) was found by that load test, fixed
  using this codebase's own already-proven pattern (`lib/workers/admission.ts`'s
  advisory-lock transaction), verified with a deterministic two-connection integration
  test and confirmed live on staging (pre-fix: 3 simultaneous demo jobs from one burst;
  post-fix: exactly 1, with the others correctly rejected).

**Not validated live, flagged honestly rather than assumed**: the repurpose-video
workflow (needs a real uploaded source file; blocked by this session's tooling, not by
any code issue — its unit/integration coverage is green) and the failure/refund path
(not directly triggered on staging this pass; rests on the existing real-Postgres
integration tests in `lib/jobs/*-runner.test.ts` that specifically cover reservation
release, atomic failure finalization, and lease-loss mid-render). Both are pre-existing,
already-tested code paths untouched by this release's actual diff — the gap is in this
session's live-staging coverage, not in the code's test coverage.

---

## 1. Pre-flight checklist (all must be true before starting)

- [ ] PR for `scale/100-user-readiness` has a green `build-check` run on the exact
      commit being deployed (`gh pr checks 1 --repo Anshumansh/clipforge`).
- [ ] Owner has given explicit go-ahead for *this* deploy (repo rule: production changes
      need explicit approval — this runbook does not constitute that approval).
- [ ] A fresh manual DB backup has been taken and confirmed uploaded, **not** relying on
      the last scheduled 3am run:
      ```bash
      ssh -i ~/.ssh/clipforge_vps root@62.238.110.10 "bash /opt/clipforge/scripts/backup-db.sh"
      # then confirm the new object exists in the clipforge-media bucket under backups/
      ```
- [ ] Confirm no jobs are actively `processing` right now, so the migration and deploy
      land on a quiet queue rather than racing in-flight work (read-only check):
      ```bash
      psql "$DATABASE_URL" -c "SELECT id, status, \"projectId\", \"createdAt\" FROM \"Job\" WHERE status IN ('queued','processing') ORDER BY \"createdAt\";"
      ```
      A few `queued` rows are fine (they wait). If anything is `processing`, either wait
      for it to finish or accept that the *old* worker will still be the one to finish it
      (safe either way — see §3, migration is additive and the old worker never reads the
      new columns).
- [ ] Confirm `_prisma_migrations` does not already exist on production with conflicting
      entries (expected: it doesn't exist at all yet, since production has only ever used
      `prisma db push` — see `QUEUE_RECOVERY.md` §5):
      ```bash
      psql "$DATABASE_URL" -c "\dt \"_prisma_migrations\""
      ```
      If this table already exists and has rows, stop and reconcile before proceeding —
      that would mean something already ran versioned migrations against production
      outside of this plan.

---

## 2. Deployment sequence

**Order matters.** The new code reads columns the migration adds; the old code never
reads them. So: migrate first, then deploy code. Reversing this order is not
catastrophic (every new column is nullable/defaulted, so old code keeps working
unmodified against the new schema) but there's no reason to reverse it either.

### Step 1 — Apply the migration (from a machine with production `DATABASE_URL`)

```bash
npx prisma migrate resolve --applied 20260814103037_baseline_matches_production
npx prisma migrate deploy
npx prisma migrate status
```

Expect the last command to print `Database schema is up to date!`. This is the exact
sequence validated in the migration rehearsal (item 4) against a disposable clone seeded
with historical-shaped data — real result there: zero data loss, all pre-existing rows
retained their values, all 15 new `Job` columns landed as `NULL`/default on existing
rows, `WorkerRegistration`/`DemoQuota` created empty, and a second `migrate deploy` run
was a clean no-op (idempotent).

**If this step fails partway**: `prisma migrate deploy` runs each migration file in its
own transaction — a failure rolls back that file's changes, it does not leave a
half-applied schema. Re-running `npx prisma migrate status` will show exactly which
migration (if any) is marked applied; safe to re-run `migrate deploy` again once the
underlying cause (e.g. a connectivity blip) is resolved.

### Step 2 — Merge and deploy the code

Standard path, unchanged from how every other change ships (`OPERATIONS.md` §10):

```bash
# Merge the PR to main through the normal review process, or:
git checkout main && git merge scale/100-user-readiness && git push origin main
```

This triggers `.github/workflows/deploy.yml`: `build-check` (typecheck, build, unit
tests, real-Postgres integration tests) must pass, then the `deploy` job SSHes in,
`git reset --hard origin/main`, `docker compose up -d --build` (rebuilds both `app` and
`worker` from the same Dockerfile — confirmed this session that both need matching env
vars; see the note on `NEXTAUTH_URL` in the final report's error log if `worker`'s build
ever fails with `Invalid URL, input: ''`), then a 60s post-deploy `/api/health` poll that
emails `support@forgecut.app` via Resend on failure.

### Step 3 — Verify

- [ ] `curl -sS https://forgecut.app/api/health` → `200`.
- [ ] `docker compose ps` on the VPS → `app`, `worker`, `caddy` all `Up`/healthy, no
      restart-looping.
- [ ] `docker logs clipforge-worker-1 --tail 50` → clean startup, no errors referencing
      the new `Job` columns or `WorkerRegistration`.
- [ ] Confirm the new tables/columns are actually visible to the running app (not just
      the DB):
      ```bash
      psql "$DATABASE_URL" -c "SELECT count(*) FROM \"WorkerRegistration\";"
      psql "$DATABASE_URL" -c "SELECT priority, \"attemptCount\", \"leaseExpiresAt\" FROM \"Job\" LIMIT 1;"
      ```
- [ ] Submit one real, low-cost generation (e.g. via the demo endpoint or a real account)
      and confirm it reaches `done` with `leaseExpiresAt`/`workerId`/`attemptCount`
      populated on its `Job` row — proves the new claim path is actually live, not just
      present in the schema.
- [ ] Watch `docker logs clipforge-worker-1 -f` through one full heartbeat interval
      (~15s) during that job — expect to see lease-renewal activity, not just claim +
      finish.

---

## 3. Rollback

**If a rollback is needed, follow `OPERATIONS.md` §12b exactly** (stop the worker
*before* touching code, verify it actually stopped, then restore code) — that procedure
already accounts for the specific hazard of two reconciliation implementations racing
each other. This release doesn't change that hazard or that procedure.

The one addition specific to this release's real migration history (vs. the plain
`db push` §12b was originally written around):

```bash
# After the worker is confirmed stopped (OPERATIONS.md §12b step 2-3), and after
# code has been rolled back to the pre-branch checkpoint (step 4):
npx prisma migrate resolve --rolled-back 20260814103100_add_queue_lifecycle_fencing
# Then drop the columns/tables by hand -- Prisma has no automatic "down" migration.
# Every new column is nullable with no FK/NOT NULL constraint and no pre-branch code
# reads them, so this is safe to run any time after the worker is stopped:
psql "$DATABASE_URL" <<'SQL'
ALTER TABLE "Job"
  DROP COLUMN IF EXISTS "priority",
  DROP COLUMN IF EXISTS "attemptCount",
  DROP COLUMN IF EXISTS "maxAttempts",
  DROP COLUMN IF EXISTS "leaseExpiresAt",
  DROP COLUMN IF EXISTS "workerId",
  DROP COLUMN IF EXISTS "heartbeatAt",
  DROP COLUMN IF EXISTS "stage",
  DROP COLUMN IF EXISTS "deadLetteredAt",
  DROP COLUMN IF EXISTS "cancelledAt",
  DROP COLUMN IF EXISTS "notBeforeAt";
DROP TABLE IF EXISTS "WorkerRegistration";
DROP TABLE IF EXISTS "DemoQuota";
SQL
```

No credit/reservation data needs manual reconciliation as part of this rollback —
`CreditReservation.status` remains the sole authoritative record and is untouched by
either the migration or its rollback (`QUEUE_RECOVERY.md` §5).

---

## 4. Monitoring

**This release does not change production's monitoring.** Production's existing
self-healing system (`OPERATIONS.md` §19 — `/api/health`, Docker healthchecks,
`scripts/watchdog.sh` cron, Resend email alerts on state transitions) is unaffected and
needs no changes for this deploy to be observable at the level it already supports.

This validation pass separately proved a full Prometheus + Grafana stack (authenticated
scraping, a real dashboard, a real fired-and-delivered alert) against staging — real,
working evidence that richer monitoring is straightforward to stand up on this
codebase's existing `/api/internal/metrics` endpoint. Deploying that same stack to
production is a genuine improvement worth doing, but it's new infrastructure the current
scope explicitly excludes (Part D: "do not add optional features or redesign working
systems"). Recommended as a **separate, follow-up, owner-scoped decision** — not a
blocker for this release, and not bundled into it.

---

## 5. What the load-test evidence does and does not say about production capacity

Staging's Railway container is a different (smaller, unmeasured-by-me) size than the
production Hetzner VPS, and staging's AI provider is mocked (`aiProvider: "mock"` on
every `JobCostRecord` observed this session) — real renders there measured ~36-40s,
against production's own real-provider measured mean of **97.7s** (`CAPACITY_MODEL.md`
§1). So the staging load-test numbers (p50/p99 latency, req/s at each concurrency tier)
are evidence that **the code scales correctly under concurrency** — no errors, no
correctness regressions, no connection-pool exhaustion, graceful (not catastrophic)
latency growth under load, and the specific concurrency bug this pass found and fixed —
not a literal prediction of production's req/s ceiling or render throughput. For that,
`CAPACITY_MODEL.md`'s own production-measured numbers (97.7s/render, 1 worker ≈ 36.8
jobs/hour, 100-job burst ≈ 163 minutes to clear on today's single-worker architecture)
remain the authoritative figures, and this release does not change them — it changes
whether a stale/crashed worker's lease gets correctly reclaimed, not how fast a healthy
one renders.

One real, code-level finding from the staging load test worth carrying into production
awareness: the public homepage (`/`, ISR with `revalidate = 300` and one `db.project
.count()` query) showed p50 latency degrading from 535ms at 10 concurrent requests to
3050ms at 150 (throughput plateauing, not crashing — 0 errors at every tier), while
`/login`, `/dashboard`, `/api/projects`, and `/api/internal/metrics` all stayed flat
(~420-460ms p50 regardless of concurrency). Not a regression introduced by this branch
(the homepage code is unchanged by this release) and not a release blocker (no errors,
no failures, just slower) — flagged as a pre-existing characteristic worth a follow-up
look (likely ISR revalidation-contention behavior under concurrent cache misses) if
homepage traffic ever approaches the tested range.

---

## 6. Known residual risks carried into this release (not fixed, by design or scope)

- **Single-worker-only remains a hard constraint.** This release's lease/heartbeat
  mechanism is the prerequisite `CAPACITY_MODEL.md` §4 identified for eventual
  multi-worker support, not multi-worker support itself. Do not scale the `worker`
  service without separately implementing and testing that.
- **The in-memory rate limiter** (`lib/rate-limit.ts`, gates demo/IP/login-attempt
  limits) still resets on process restart and still only coordinates within one process
  — unaffected by this release. `lib/demo/quota.ts` has a DB-backed, concurrency-proven
  alternative already sitting unused in the codebase (deliberately not wired in — the
  two mechanisms enforce different numeric limits, a product decision left for the
  owner, per that file's own test comments).
- **In-runner failures are still not retried**, only worker-crash/stale-lease recovery
  is (`QUEUE_RECOVERY.md` §2, "Deliberately not extended to in-runner errors") —
  unclassified error retry remains explicitly out of scope.
- **In-flight job cancellation is still not implemented** — `cancelQueuedJob` only
  handles not-yet-claimed jobs.
- **The "upload-then-crash" B2-orphan gap** (`OPERATIONS.md` §12a) is unchanged by this
  release.
