# Clipforge Release Candidate Validation — Evidence Report

**Date:** 2026-08-14
**Branch:** `scale/100-user-readiness`, starting commit `6543053`
**Status:** IN PROGRESS — this document is being built incrementally as each
item below is completed. Do not treat an unfinished section as a negative
result; treat it as not yet attempted.

This report follows the 9-item Release Candidate Validation request. No
merge, no production deployment, no production mutation has occurred or
will occur as part of this work.

---

## 1. Migration reconciliation — COMPLETE

**Method:** Read-only introspection of the actual production database
(the one configured as `DATABASE_URL` in `.env`, a Neon Postgres instance).
Queried only `information_schema.tables`, `information_schema.columns`,
`pg_indexes`, and `information_schema.table_constraints` — no row data from
any business table was read, no writes were made, and the session was
wrapped in `SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY` /
`BEGIN TRANSACTION READ ONLY` as a hard guarantee.

**Finding 1 — no migration history exists in production.**
`_prisma_migrations` does not exist as a table. Confirms `prisma db push`
has been the only schema-deployment path ever used against this database.

**Finding 2 — production has 40 tables; schema.prisma defines 42.**
Missing entirely: `WorkerRegistration`, `DemoQuota`.

**Finding 3 — production's `Job` table has only its original 9 columns**
(`id, userId, projectId, type, status, progress, log, createdAt,
updatedAt`) and only its primary-key index. None of the 15 queue-lifecycle-
hardening columns (`priority, attemptCount, maxAttempts, leaseExpiresAt,
workerId, heartbeatAt, attemptToken, stage, completedAt, failedAt,
deadLetteredAt, cancelledAt, notBeforeAt, failureReason, idempotencyKey`)
or their 4 indexes exist.

**Finding 4 — everything else already matches.** A systematic (not
spot-checked) column-by-column and index-by-index diff between the
production snapshot and a local database built from the current
`schema.prisma` found zero other gaps. `User` and `Project` showed only
column-*ordering* differences (consistent with production having
accumulated columns via incremental `ALTER TABLE ADD COLUMN` over time,
versus a fresh `CREATE TABLE` following declaration order) — not missing
columns. `CreditReservation`, `JobCostRecord`, `StripeWebhookEvent`, and
every other table matched exactly.

**Conclusion: the previously-generated single baseline migration
represented the latest development schema, not production's actual
schema, and contained substantial unapplied changes.** It has been split
into two migrations (commit `9f52e2e`):

| Migration | Database object(s) changed | Present in production? | Present in staging? | Safe action | Rollback / forward-recovery |
|---|---|---|---|---|---|
| `20260814103037_baseline_matches_production` | All 40 pre-existing tables (User, Project, Job [original 9 cols only], CreditReservation, JobCostRecord, StripeWebhookEvent, Clip, ClipCandidate, Workspace + members/invites, CreditLedgerEntry, ApiKey, BrandKit/BrandPreset, Password/EmailVerification tokens, AdminAction, KillSwitch, MarginAlert, MonthlyExpense, PlanVersion, PriceSnapshot, CompetitorBenchmark, DisclaimerConfig, FeatureRequest/Vote, CaptureSession, SpeakerSegment, HighlightScore, TradeCall, GameTemplate, SocialAccount/Post, TrackedChannel, TrendSnapshot, YoutubeVideo, BreakoutScore, ExtractedPattern, UserNiche) | **YES** — verified via read-only introspection, 2026-08-14 | N/A — no staging environment exists yet (item 3) | `prisma migrate resolve --applied 20260814103037_baseline_matches_production` against production. Records the migration as satisfied WITHOUT executing any DDL — safe specifically because every object in it was independently confirmed to already exist. | Not applicable — `migrate resolve` only writes a row to `_prisma_migrations`; nothing to roll back structurally. To undo: `DELETE FROM "_prisma_migrations" WHERE migration_name = '...'`. |
| `20260814103100_add_queue_lifecycle_fencing` | `Job`: +15 columns (all nullable or `NOT NULL DEFAULT`), +4 indexes. New tables: `WorkerRegistration` (+3 indexes), `DemoQuota` (+4 indexes) | **NO** — confirmed absent | N/A — no staging environment exists yet (item 3) | Must be **executed for real** via `prisma migrate deploy` — never marked pre-applied. Every `ADD COLUMN` is nullable or has a `DEFAULT`, so it's a fast, lock-light operation with no backfill and no table rewrite; existing `Job` rows get `attemptToken=NULL`/`workerId=NULL`/etc. (correct semantics: "not currently fenced," matching their pre-lease-fencing history) and `priority=0`/`attemptCount=0`/`maxAttempts=3` (same defaults new rows get). `CreditReservation` has zero schema changes in this migration. | Postgres DDL is transactional — a failure mid-migration rolls back cleanly to the pre-migration state; forward-recovery is simply re-running `prisma migrate deploy`. Rollback if needed after a successful apply: `ALTER TABLE "Job" DROP COLUMN "priority", DROP COLUMN "attemptCount", ... (all 15)`, `DROP TABLE "WorkerRegistration"`, `DROP TABLE "DemoQuota"` — safe because nothing in the pre-fencing code path reads these objects. |

**Verified, not assumed:** (a) the two-migration split reconstructs the
exact current `schema.prisma` state — `prisma migrate diff` between "apply
both migrations" and "current schema via `db push`" produces zero DDL
statements; (b) the baseline **alone** (without the second migration)
reproduces production's exact shape — a dedicated test applies only the
baseline SQL and asserts `Job` still has just its original 9 columns and
`WorkerRegistration`/`DemoQuota` don't exist. Both proven in
`prisma/migration.integration.test.ts` against real local Postgres, commit
`9f52e2e`.

**Historical row validity:** every new `Job` column is additive
(nullable or defaulted), so no existing `Job` or `CreditReservation` row is
invalidated, altered, or requires backfill by either migration.

**What was NOT done:** neither migration has been run or resolved against
the real production database. That remains an explicit owner action (see
the runbook, item 8, and the final verdict, item 9).

---

## 2. Push branch and run real CI — COMPLETE

**PR:** [Anshumansh/clipforge#1](https://github.com/Anshumansh/clipforge/pull/1)
— open, not merged.

**Prerequisite fix, committed first (`36a7b92`):** `deploy.yml` previously
only triggered on push-to-`main` or `workflow_dispatch`, with the `deploy`
job (real SSH + redeploy) unconditionally chained after `build-check` via
`needs:` alone — there was no way to run the validation gates against a PR
without also risking a real deploy if manually dispatched. Added a
`pull_request: branches: [main]` trigger for validation, and explicitly
gated the `deploy` job with
`if: github.event_name == 'push' && github.ref == 'refs/heads/main'` so a
PR event can never reach the SSH/redeploy step, regardless of `needs:`.

**Run 1 — found a real CI-only bug (commit `338573a` fixes it):**
[run 31797082344](https://github.com/Anshumansh/clipforge/actions/runs/31797082344)
failed at "Prisma schema validation" with `P1012: Environment variable not
found: DATABASE_URL`. Local verification when these gates were added
(Phase E) always had `.env` loaded automatically by the Prisma CLI, masking
this — CI has no `.env` file. Fixed by moving the dummy env vars from the
`Build` step to job level so every step sees them.

**Run 2 — green:**

| | |
|---|---|
| Workflow URL | https://github.com/Anshumansh/clipforge/actions/runs/31797227856 |
| Run ID | `31797227856` |
| Commit SHA | `338573afd3723d514fcbfff16d9dd963ea555a9e` |
| Trigger | `pull_request` (PR #1) |
| `build-check` | ✅ success, 2m52s — every step passed: checkout, setup-node, `npm ci`, Prisma schema validation, Typecheck, Build, Worker build, Unit tests, **PostgreSQL integration tests** (the real embedded-Postgres suite, confirmed running on the actual GitHub Actions runner, not just locally) |
| `deploy` | **skipped** (by design — `pull_request` event doesn't satisfy the job's `if:` condition; confirmed via `gh pr checks 1` showing `deploy  skipping`) |
| `continue-on-error` anywhere in the workflow | **0 occurrences** (`grep -c continue-on-error .github/workflows/deploy.yml`) |

No required step was skipped or marked non-blocking. The one failure found
was fixed and the pipeline reran green. `main` was never touched; nothing
was merged or deployed.



## 3. Staging environment — PENDING

## 4. Migration rehearsal on staging — PENDING

## 5. Staging end-to-end tests — PENDING

## 6. Monitoring in staging — PENDING

## 7. Full application load tests — PENDING

## 8. Production runbook — PENDING

## 9. Final decision — PENDING
