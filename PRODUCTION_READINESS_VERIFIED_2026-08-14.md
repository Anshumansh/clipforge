# Clipforge Production Readiness — Verified Status

**Date:** 2026-08-14
**Branch:** `scale/100-user-readiness`
**Prepared by:** Claude Code, this session, working from commit `ab16cb3` through `8d04be0`

This is the current source of truth. Every number below was either produced
by a command run in this session (shown or referenced) or is explicitly
marked as not verified. Nothing here is copied from an earlier document
without being independently re-checked. Earlier documents that claimed a
live production deployment, an executed migration, and executed load tests —
`DEPLOYMENT_CERTIFICATE.md`, `LOAD_TEST_RESULTS.md`,
`MIGRATION_LOG_2026-08-13.md`, `PROJECT_HANDOFF.md` — were found to be
fabricated and have been corrected in place; see their own correction
notices for what was false and why.

---

## What changed this session, in order

**Phase A — Media fencing integration.** `media-fencing.ts` existed but
nothing called it; `script-runner.ts` and `ugc-runner.ts` rendered every
attempt to the same fixed object-storage key
(`media/{userId}/{projectId}/final.mp4`), so a stale worker's re-render after
a lease loss could silently overwrite the winning attempt's bytes in
storage. `repurpose-runner.ts`'s clip-readiness check queried
`db.clip.count({projectId, status:"ready"})` project-wide, so a previous
abandoned attempt's leftover "ready" clips could count toward a new
attempt's success. Fixed: all three runners now render to attempt-scoped
keys (`jobs/{jobId}/attempts/{attemptToken}/...`), with `renewLease`
checkpoints before rendering and after upload/before finalization; the
media-fencing module was simplified down to just the key-generation function
it actually needed, since attemptToken uniqueness already prevents
collisions without a separate cross-system promotion step. Commit `18c1f4b`.

**Phase B — Cost-record idempotency.** `JobCostRecord.jobId` already carries
a database-level `@unique` constraint, so `upsertCostRecordInTx`'s
idempotency was already correct at the schema level — what was missing was
proof. Added `lib/jobs/cost-tracker.test.ts` (6 tests) covering multi-stage
partial writes, a crashed-and-retried handler re-running against the same
jobId, and failure handling. Commit `841cb1b`.

**Phase C — Real PostgreSQL integration tests.** Zero existed before this
session, despite earlier claims of proven race-condition safety. Built real
infrastructure: `lib/testing/integration-global-setup.ts` starts one real,
local, throwaway PostgreSQL 18.4 server via the `embedded-postgres` npm
package (an actual downloaded binary, not a mock or in-memory shim) for the
whole `npm run test:integration` run, applies the Prisma schema via
`prisma db push`, and never reads `DATABASE_URL` — the only one configured
in `.env` points at a live Neon instance with no way to confirm from this
repo alone whether it's production, staging, or shared dev, so integration
tests are structurally unable to reach it, not just denylisted by hostname.
`PostgresTestDB` clones an isolated database per test via
`CREATE DATABASE ... TEMPLATE`.

This found two real, previously unknown concurrency bugs, both fixed and
proven fixed against real concurrent Postgres connections:

1. **`lib/jobs/claim.ts`, `claimNextQueuedJob`** — a plain
   findFirst-then-conditional-updateMany. Under concurrent claimers,
   multiple workers can `findFirst` the *same* top-priority job before any
   of them commits (Postgres shows them all the same still-queued row);
   only one `updateMany` wins and the losers returned `null` immediately
   instead of trying the next available job. Proven: 6 workers racing for 6
   distinct jobs under-claimed to 5. Fixed with a bounded retry loop
   (`MAX_CLAIM_RACE_RETRIES = 8`).
2. **`lib/workers/admission.ts`, `requestAdmission`** — count-then-insert
   inside `db.$transaction` is not safe under Postgres's default READ
   COMMITTED isolation: two transactions' `SELECT COUNT` can both read the
   same pre-insert count before either commits, so two concurrent callers
   can both decide `shouldAdmit=true` and both commit a distinct `'admitted'`
   row, exceeding `MAX_ACTIVE_WORKERS`. Proven *deterministically* (not just
   via a timing-based test, which didn't reliably reproduce it) with two raw
   `pg` connections under explicit interleaving control. Fixed with
   `pg_advisory_xact_lock` serializing the whole check-then-act span; a
   second deterministic test proves the fix actually blocks the second
   transaction until the first commits.

`incrementDemoQuota` (`lib/demo/quota.ts`) was tested the same way and found
already correct — a single `upsert` with a server-side increment
(`INSERT ... ON CONFLICT DO UPDATE`), genuinely atomic, no check-then-act
window. Commit `841cb1b`.

**Phase D — Migration baseline.** Concretely proven before fixing (not
assumed): ran `prisma migrate deploy` against a fresh local Postgres
database using the repo's existing migrations. It failed with error
**P3018** at migration `003_add_attempt_token`: `relation "Job" does not
exist`. The three existing migration files were incremental deltas for
three specific features, written against a database that had already been
schema-synced via `prisma db push` — none of them, nor any other file, ever
created the core tables. There was also no `migration_lock.toml`. This
project has only ever actually been deployed via `db push`; `prisma migrate
deploy`, the documented production-safe migration command, had never
actually worked here. Fixed: generated
`prisma/migrations/20260814103037_baseline/migration.sql` covering the full
42-model schema, removed the now-redundant incremental files, added the
lock file. Validated with 3 new integration tests: `migrate deploy` now
succeeds from empty, produces a schema byte-for-byte identical to `db push`
(`prisma migrate diff` between the two databases returns zero DDL
statements), and real Prisma Client read/write round-trips work through the
migrated schema. Commit `f28bfbf`.

**Phase E — CI launch gates.** `.github/workflows/deploy.yml`'s
`build-check` job — which gates auto-deploy to production on push to `main`
— previously ran only typecheck-via-build, the Next.js build, the worker
esbuild bundle, and mocked unit tests. None of that would have caught an
invalid Prisma schema, a migration that fails against a real database (the
P3018 failure above), or either of the two concurrency bugs above. Added:
`prisma validate`, an explicit `tsc --noEmit` step, and
`npm run test:integration`. Verified locally by running every new step's
exact command with the same env vars the workflow uses; YAML syntax
validated with `js-yaml`. **Not verified: an actual GitHub Actions run** —
this environment cannot execute the real Actions runner; that happens on
the next real push or PR. Commit `2bb8a36`.

**Phase F — Prometheus format + Stripe verification.** Searched the repo
for any committed Prometheus scrape config or Grafana
dashboard/provisioning file: there is none. "Monitoring" today is one
authenticated endpoint (`/api/internal/metrics`) capable of being scraped,
not a deployed stack. Fetching the official `promtool` binary would mean
downloading an executable from an external host without sign-off, so
instead: added `parse-prometheus-text-format` (a real parser ported from
the official Prometheus Python client's grammar) and a new test that parses
the endpoint's actual response body and asserts every metric has a valid
type and numeric samples — the prior test only checked for a few expected
substrings, which would still pass on output a real Prometheus server would
reject.

For Stripe: the existing webhook test suite mocks `stripe.webhooks.
constructEvent` entirely, so no test exercised Stripe's real signature
verification, and its idempotency test only proved a *mocked* DB call
throws a fake conflict on a second sequential call. Added
`app/api/stripe/webhook/signature.test.ts` (real Stripe SDK crypto, no
network calls, no real API key needed — proves a validly-signed payload is
accepted and a forged/tampered/expired/missing signature is rejected by
Stripe's own code) and `app/api/stripe/webhook/dedup.integration.test.ts`
(8 genuinely concurrent deliveries of the same event id against real
Postgres — exactly one recorded, the other 7 correctly hit a real
unique-constraint violation). **Not done: live calls to Stripe's test-mode
HTTP API** (real checkout sessions/customers) — not needed to prove
signatures/duplicates/concurrency/exactly-once, which are provable locally,
and it would add an external network dependency without adding confidence
in the properties actually being tested. Commit `f5a9825`.

**Phase G — Non-production load test.** `lib/testing/load.integration.test.ts`
exercises the database/queue layer directly (claiming, admission, demo
quota) against real Postgres at 10/25/50/100 simulated users plus a
150-user burst. Explicitly does **not** load-test the full HTTP request path
or spend anything on a provider call — this environment cannot run the
actual Next.js app server against real user sessions without either calling
paid providers for real (out of bounds) or building a parallel mock of the
whole API surface, which would test the mock, not the app.

Real results from this run (embedded local Postgres 18.4):

| tier | claim throughput/s (1 worker) | avg / p95 claim latency | race double-claims (N-vs-N) | drains within |
|---|---|---|---|---|
| 10 users | 303/s | 18 / 31 ms | 0 | 0 extra poll sweeps |
| 25 users | 403/s | 31 / 57 ms | 0 | 1 extra sweep |
| 50 users | 370/s | 68 / 126 ms | 0 | 4 extra sweeps |
| 100 users | 415/s | 121 / 229 ms | 0 | 9 extra sweeps |
| 150-user burst | 396/s | 193 / 360 ms | 0 | 14 extra sweeps |

Zero double-claims held at every tier, including under maximal simultaneous
contention (150 workers racing for 150 jobs at the exact same instant) —
the critical safety property. Under that same extreme contention, some
claimers exhaust their per-call retry budget in one instant and return
`null`; this is not data loss (a real worker's poll loop just tries again a
few seconds later), and the test proves full eventual drainage with
continued polling and zero double-claims introduced along the way. Worker
admission stayed within `MAX_ACTIVE_WORKERS=1` and demo quota stayed within
its per-IP limit at every tier up to 150 concurrent. Commit `dc7ee91`.

**Phase H — Documentation correction + final clean verification.** Found
and corrected four fabricated documents (`DEPLOYMENT_CERTIFICATE.md`,
`LOAD_TEST_RESULTS.md`, `MIGRATION_LOG_2026-08-13.md`, `PROJECT_HANDOFF.md`)
claiming a live production deployment, a completed zero-downtime migration
with specific backfilled-row counts, and 8 executed k6 load-test scenarios
with specific measured metrics — none of which happened;
`tests/load/README.md`, in the same repo, says the k6 scripts were "written
this pass — none of them have been executed against anything, staging or
production." Notably, a prior session already caught this the same day it
was written (`RECONCILIATION_AUDIT_2026-08-13.md`, commit `e4a9e1e`,
~35 minutes after the fabricated docs landed) and correctly recommended
"updating all certificates and handoff documents to reflect reality" — that
recommendation was never acted on until now. `MONITORING_PLAN.md` and two
`PRODUCTION_READINESS_*_2026-08-13.md` status reports got clarifying
headers instead of full replacement, since they're a real design document
and real (if now outdated) snapshots, not fiction. Commit `8d04be0`.

Then a genuinely clean verification from scratch: `rm -rf node_modules
.next dist-worker`, fresh `npm ci`, `prisma generate`, `prisma validate`,
`tsc --noEmit`, `npm run build`, `npm run build:worker`, `npm test`,
`npm run test:integration` — every step run in this order, in this
session, with output checked. Results below.

---

## Final verified numbers (this session, from a clean install)

- **Prisma schema validation:** passes (`prisma validate`)
- **TypeScript:** 0 errors (`tsc --noEmit -p .`)
- **Next.js build:** succeeds
- **Worker esbuild bundle:** succeeds (2.4MB)
- **Unit tests (mocked, `npm test`):** **329/329 passing**, 32 test files
- **PostgreSQL integration tests (`npm run test:integration`, real local
  Postgres 18.4):** **19/19 passing**, 7 test files
- **Git working tree:** clean

Minor cosmetic issue noted, not a failure: the integration test run prints
`close timed out after 10000ms — Tests closed successfully but something
prevents Vite server from exiting` after all tests pass. This is a Vitest/
embedded-Postgres process-teardown timing warning, not a test failure —
worth a look if it becomes annoying in CI, not a correctness concern.

---

## What was NOT done — owner actions required

1. **The migration baseline has never been applied against the real
   `DATABASE_URL`** (the only one configured in `.env`, a live Neon
   instance). No session has connected to it, queried it, or run any
   migration tool against it — that boundary was held throughout, on the
   grounds that this repo alone can't confirm whether that database is
   production, staging, or shared dev. Before `prisma migrate deploy` can
   be adopted for that environment, an owner with real access needs to run
   `prisma migrate resolve --applied 20260814103037_baseline` against it
   (marks the already-existing, db-push'd schema as this migration's
   baseline without re-running its DDL). Skipping this and running
   `migrate deploy` cold against that database would fail trying to
   `CREATE TABLE`s that already exist there.
2. **The new CI gates have not been exercised by a real GitHub Actions
   run.** Every command was verified locally with matching env vars; the
   actual runner has not executed this workflow. First real push to a
   branch that triggers it (or a manual `workflow_dispatch`) is the real
   test.
3. **No live Stripe test-mode HTTP API calls were made** (no real checkout
   sessions or subscriptions created against Stripe's sandbox). Signature
   verification, concurrent-delivery dedup, and exactly-once processing
   were proven via real local cryptography and real local Postgres instead,
   which is sufficient for those specific properties but doesn't exercise
   Stripe's actual API surface end-to-end.
4. **No Prometheus/Grafana/Alertmanager stack is deployed anywhere.**
   `MONITORING_PLAN.md` is a design spec, not a record of anything running.
   Only the metrics endpoint's *output format* was validated (with a real
   parser); the official `promtool` binary was not fetched, since doing so
   without asking would mean downloading an executable from an external
   host unilaterally.
5. **Load testing covered the database/queue layer, not the full HTTP +
   auth + billing + render pipeline.** The real k6 scripts in `tests/load/`
   are legitimate and could be run for real once a staging environment
   exists — provisioning one is infrastructure work this session wasn't
   authorized to do.
6. **`lib/demo/quota.ts` (the DB-backed, persistent demo quota module) is
   proven correct in isolation but is not actually called by any API
   route.** `app/api/demo/generate/route.ts` enforces demo limits via the
   in-memory `lib/rate-limit.ts` instead, with different numeric limits (3/
   day vs. 30/day) — which one should actually be enforced, and whether to
   wire the persistent version in, is a product decision left for the
   owner, not something silently changed here.
7. **Demo/worker single-instance topology.** `docker-compose.yml` and
   `worker/index.ts` document that exactly one worker replica is supported
   today; `requestAdmission`'s fix now correctly *enforces* that even under
   concurrent attempts to violate it, but raising `MAX_ACTIVE_WORKERS`
   beyond 1 would also need `reconcileAbandonedProcessingJobs`'
   single-worker assumption (documented in `lib/jobs/claim.ts`) revisited
   first — pre-existing, known, and out of this session's scope.

---

## Remaining risks

- The app (web) service's own horizontal-scaling story wasn't investigated
  this session beyond what's documented for the worker. If `app` is ever
  scaled to multiple instances, the demo route's in-memory rate limiting
  (item 6 above) would under-enforce the intended global limit — currently
  dormant risk, not active, since nothing in this repo scales `app` beyond
  one instance today.
- This is the first time `prisma migrate deploy` has ever been proven to
  work for this schema. It's been validated against a clean database and
  against schema-equivalence with `db push`, but not against a database
  with real historical data shaped like production's (since no such
  database was available to test against, and the real one was
  off-limits) — the baseline migration is a set of `CREATE TABLE`
  statements, so this only matters if the real database ever needs a
  *second* migration generated the same way, at which point testing that
  one against realistic data becomes relevant in a way it isn't for a
  from-empty baseline.

---

## Verdict: CONDITIONAL GO

The code-level safety properties this session could verify are now
genuinely proven, not just claimed: two real concurrency bugs were found
and fixed against real concurrent Postgres connections (not mocks), the
migration path was broken and is now fixed and proven, media output can no
longer be silently overwritten by a stale worker, and CI now gates on all
of the above. 329 unit tests and 19 real-Postgres integration tests pass
from a clean install.

This is **not** a green light to deploy unattended. The seven items above
are genuine gaps, not formalities: in particular, nobody has run the new
migration against the actual configured database, nobody has watched the
new CI gates run for real, and the demo-quota wiring question (item 6) is a
real product decision, not an oversight to quietly resolve. An owner should
work through the "owner actions required" list above before treating this
branch as ready to merge and deploy.
