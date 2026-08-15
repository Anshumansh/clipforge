# Clipforge — Queue Lifecycle & Recovery

Written 2026-08-13, `scale/100-user-readiness` branch. Documents the queue-lifecycle
hardening implemented this pass: lease-based claiming, worker heartbeats, retry with
backoff, dead-lettering, and priority. Not deployed — this describes what's on the
branch, with the exact migration/rollback steps needed before it goes to production.

## 1. Why this exists

Phase 3's original claiming design (see `OPERATIONS.md` §12a) was correct for exactly
one worker: `reconcileAbandonedProcessingJobs()` treated *every* `"processing"` job at
startup as abandoned by a crashed predecessor, because there was no way to tell "crashed"
apart from "a healthy peer is still working on it." That's safe with one worker, but it's
the specific thing that makes running more than one worker unsafe — a prerequisite for
the throughput math in `CAPACITY_MODEL.md` (17 workers needed to clear 100 queued jobs in
~10 minutes). This pass builds the missing piece: a lease.

## 2. What changed, precisely

### Schema (additive only — see §5 for the exact migration)

`Job` gained: `priority`, `attemptCount`, `maxAttempts`, `leaseExpiresAt`, `workerId`,
`heartbeatAt`, `stage`, `deadLetteredAt`, `cancelledAt`, `notBeforeAt`. Every field is
nullable or has a default that matches the old implicit behavior — no existing row needs
to change, and no existing code path breaks by their mere presence.

### Status vocabulary — a deliberate scoping decision

The brief that prompted this work asked for a lifecycle of `queued / leased / processing
/ completed / failed_retryable / failed_terminal / cancelled / dead_letter`. This
implementation does **not** rename `done`→`completed` or split `failed` into
`failed_retryable`/`failed_terminal`. Those renames would be breaking: `Job.status`
string comparisons exist in every runner, `lib/jobs/claim.ts`, the dashboard's status
badge mapping, and (critically) in every historical row already in production — a rename
needs a data migration touching real customer data, not just new code. Given rule #5's
requirement for backward-compatible migrations, that trade was not worth making for a
naming change with no functional benefit over the alternative below.

Instead:
- **`queued`/`processing`/`done`/`failed`** — unchanged, same meaning as before.
- **`leased`** — not a separate status. A job is leased exactly when
  `status="processing" AND leaseExpiresAt` is in the future. In this architecture,
  claiming and starting execution are atomic (the same `updateMany` call), so there's no
  real-world gap between "leased" and "processing" to represent separately.
- **retryable vs. terminal failure** — not two status strings. Whether a failure is
  retried is decided by `attemptCount < maxAttempts` at the moment of reconciliation, not
  baked into the status value itself.
- **`dead_letter`** (new) — a job that exhausted `maxAttempts`. Distinguishable from a
  first-attempt in-runner failure (`failed`), which is intentional — see §4.
- **`cancelled`** (new) — a queued job explicitly cancelled before being claimed.

### Priority

`priority` (default `0`) orders claiming: `ORDER BY priority DESC, createdAt ASC`. Demo
jobs are created with `JOB_PRIORITY_DEMO = -10` (`app/api/demo/generate/route.ts`), so a
paid job queued after a burst of demos still claims ahead of them. This is a partial
implementation of the brief's fuller 7-tier system (paid-priority / standard / free /
demo / heavy / 4K / voice-cloning) — only the demo tier is wired, because "demos must
never outrank a paying customer" is unambiguous and immediately actionable; classifying
every workflow into the other 6 tiers and threading that through every creation path is
real, separate follow-up work.

### Leasing and heartbeats

`claimNextQueuedJob(workerId)` now stamps `leaseExpiresAt = now + LEASE_DURATION_MS`
(45s), `workerId`, and `heartbeatAt` on claim, and increments `attemptCount`. While a job
is in flight, `worker/index.ts`'s `Worker.tick()` runs a heartbeat interval (every 15s —
a third of the lease duration) calling `renewLease(jobId, workerId)`, which only succeeds
if `status="processing" AND workerId` still matches — a safe no-op if the job was somehow
reassigned. The heartbeat is deliberately **not** threaded through each runner's internal
steps (script-gen → voiceover → b-roll → render → upload) — a single interval scoped to
"this job is in flight" is simpler and gives the same safety property (a live worker's
lease never goes stale) without touching the runners at all.

### Reconciliation — now lease-aware, and runs on a timer, not just at startup

`reconcileAbandonedProcessingJobs()` (name unchanged — its purpose is still accurate,
only the mechanism changed) now queries:

```
status = "processing" AND (leaseExpiresAt IS NULL OR leaseExpiresAt < now())
```

`leaseExpiresAt IS NULL` catches legacy rows from before this migration (safe: they get
the exact same "unconditionally abandoned" treatment as before). A job whose lease
hasn't expired is excluded by construction — this is what makes the function safe to run
even if a second worker existed (though this codebase still only supports one in
practice; see §12a's still-current single-worker note in OPERATIONS.md).

It now also runs on a recurring timer inside `Worker.start()` (every ~30s by default,
`reconcileIntervalMs` option), not only once at process startup — a lease can go stale
mid-run (a hang, not just a crash-before-restart), which the old startup-only call would
never catch until the next restart.

### Retry with backoff, and why it's scoped to reconciliation only

A job found abandoned with `attemptCount < maxAttempts` (default 3) is **requeued**, not
failed: `status → "queued"`, `notBeforeAt → now + computeBackoffMs(attemptCount)`
(exponential, ~2-3s / ~4-6s / ~8-12s with jitter, capped at 60s), lease fields cleared.
`claimNextQueuedJob`'s query now excludes jobs whose `notBeforeAt` is still in the
future, so a retried job doesn't spin in a tight claim-fail-claim loop. The reservation
is left untouched — it's still legitimately in flight, and `Project.status` doesn't
change, so from the user's perspective a retried job is invisible unless it eventually
exhausts its attempts.

**Deliberately not extended to in-runner errors.** An error thrown *inside* a runner
(a provider timeout, a render failure) still goes straight to `failed`, unretried, exactly
as before this pass. A stale lease unambiguously means the *worker* died — retrying is
always correct there. An in-runner error's cause is unclassified (could be a transient
provider hiccup, or could be permanently-malformed input) — blindly retrying it up to 3
times would risk burning real AI-provider cost re-attempting something that will never
succeed. Building real error classification (which exceptions are retryable) is
out of scope for this pass; flagged here as a deliberate limitation, not an oversight.

### Dead-lettering

A job at or above `maxAttempts` is finalized atomically via the same transaction pattern
Phase 3 already established for `"failed"` (`Job` updated + `Project` marked failed +
reservation released, or a legacy refund if no reservation exists), just with
`status="dead_letter"` and `deadLetteredAt` stamped instead of `"failed"`. This reuses
the exact same `finalizeJobTerminal()` helper the claim-time defensive path already used
— both callers now share one atomic-transaction implementation instead of two near-copies.

### Cancellation

`cancelQueuedJob(jobId)` atomically cancels a job that is still `"queued"` (never
claimed) and releases its reservation exactly once — same transaction pattern again.
Returns `false` (not an error) if the job was already claimed or terminal by the time the
call runs — "too late to cancel" is a normal outcome, not a failure. **Cancelling an
already-`"processing"` job is not implemented.** Safely interrupting an in-flight
Remotion/Chromium/ffmpeg render without leaking the child process or racing the runner's
own success/failure finalization needs a cancellation signal threaded through the runner
itself — real, separate follow-up work. No UI wiring (a "Cancel" button) was added this
pass either — the backend function exists and is tested; nothing calls it yet.

## 3. What this does NOT claim

- **Multi-worker production support.** The lease mechanism is the foundation a real
  multi-worker rollout needs, but nothing in this pass has been tested under actual
  concurrent multi-worker load, and `docker-compose.yml` still runs exactly one `worker`
  service. Treat "safe under multiple workers" as "no longer structurally unsafe," not
  "verified."
- **A fully error-classified retry system.** See above — only worker-crash recovery
  retries automatically.
- **A wired 7-tier priority system.** Only the demo tier is set; the rest default to
  `priority=0`.
- **In-flight job cancellation.**

## 4. Tests

`lib/jobs/claim.test.ts` (37 tests) and `worker/index.test.ts` (18 tests, +6 new for
heartbeat renewal and periodic reconciliation) cover: priority ordering in the claim
query, lease stamping on claim, `renewLease`'s worker-ownership guard, retry-vs-dead-letter
branching at every `attemptCount`/`maxAttempts` boundary, atomic dead-letter finalization
(including a DB-failure-mid-transaction rollback-safety test, same pattern as Phase 3's
own), `cancelQueuedJob`'s three outcomes (cancelled / already-claimed no-op / no
reservation), and all four of Phase 3's original required crash-recovery scenarios
(A-D), re-verified against the new lease-aware behavior. Full suite: 302/302 passing,
`tsc --noEmit` clean, `next build` and `npm run build:worker` both succeed.

## 5. Migration — exact steps and rollback

> **Updated 2026-08-15 (Release Candidate Validation, item 1) — supersedes the `db push`
> plan originally written below.** Reconciling this branch against production's actual
> schema (read-only introspection, never touching row data) found that production has
> been running on ad-hoc `prisma db push` with **no migration history table populated at
> all** — safe for solo iteration, but with no record of exactly which schema state is
> live, no repeatable/auditable apply step, and no clean way to verify a target database
> matches what the branch expects before touching it. Rather than push this same
> undocumented pattern for the highest-risk change yet (the first schema change on a
> paid product with real customer rows), this branch now carries real versioned
> migrations under `prisma/migrations/`:
> - `20260814103037_baseline_matches_production` — the 40 tables independently confirmed
>   already present in production via read-only introspection, exactly as they exist
>   today. Contains no new columns from this pass. This migration is never *run* against
>   production — it's marked pre-applied (`prisma migrate resolve --applied
>   20260814103037_baseline_matches_production`), which only writes a row to
>   `_prisma_migrations` recording "this state already exists," identical in effect to
>   what years of `db push` calls already produced, just now with a name and a checksum.
> - `20260814103100_add_queue_lifecycle_fencing` — the genuine delta this section
>   describes: `Job`'s 15 new columns/4 indexes, plus `WorkerRegistration` and
>   `DemoQuota`. This one is run for real via `prisma migrate deploy`.
>
> Both migrations were validated end-to-end against a disposable Postgres clone seeded
> with production-shaped historical data (Release Candidate Validation items 1 and 4):
> resolving the baseline as pre-applied, then deploying the delta, produces a schema
> byte-for-byte identical to a fresh `prisma db push` of the current `schema.prisma` —
> and the delta migration is idempotent (a second `migrate deploy` run is a clean no-op).
> The `db push` command below still works and is not wrong, exactly as described — but it
> would leave production's migration history exactly as absent as it is today. Use the
> migration-history steps instead so this deploy is the point where production gets a
> real, auditable schema history going forward instead of just one more undocumented
> `db push`.
>
> **To apply for real (exact sequence, run once, in order):**
> ```bash
> # From a machine with DATABASE_URL pointed at production
> npx prisma migrate resolve --applied 20260814103037_baseline_matches_production
> npx prisma migrate deploy
> npx prisma migrate status   # expect: "Database schema is up to date!"
> ```
> See `PRODUCTION_DEPLOYMENT_RUNBOOK.md` for where this fits relative to the code deploy
> (schema must land before the new code that reads these columns starts running) and the
> full pre-flight checklist. The reasoning below (additive-only, nullable/defaulted
> columns, safe against live traffic, rollback must travel with the code) is unchanged by
> this update — only the apply *mechanism* changed, not the schema content or its safety
> properties.

**To apply (original plan, schema-push form — superseded above, kept for reference):**
```bash
# From a machine with DATABASE_URL pointed at the target database
npx prisma db push
```
This is a schema-only, purely additive change — no data is moved, no existing column is
altered or dropped, no row is touched. Every new column is nullable or has a default, so
existing rows remain valid without modification. Expected to be fast and low-risk even
against a live database with real traffic, but per repo rules this still requires
explicit owner approval before being run against production, and should go through the
same staged-gate process as any other production change (verify on a non-production
target first if one becomes available).

**Rollback, if needed:**
1. Revert `prisma/schema.prisma` to the pre-migration version (`git revert` this
   commit, or restore the file from `main`).
2. Run `npx prisma db push` again — Prisma will detect the now-absent columns and prompt
   to drop them. Since this pass never adds a `NOT NULL` constraint or a foreign key on
   any new column, and no code shipped *before* this migration reads these columns, a
   straightforward column-drop rollback is safe: the old code (pre-branch) never looks at
   `priority`/`attemptCount`/`leaseExpiresAt`/etc., so their removal doesn't affect it.
   (With the migration-history approach above, the equivalent rollback is `npx prisma
   migrate resolve --rolled-back 20260814103100_add_queue_lifecycle_fencing` followed by
   the same manual column drops, since Prisma has no automatic "down" migration — see
   `PRODUCTION_DEPLOYMENT_RUNBOOK.md`.)
3. **Application rollback must happen together with (not after) the schema rollback**,
   same as the general worker-architecture rollback procedure in `OPERATIONS.md` §12b:
   the NEW code (this branch) assumes these columns exist — rolling back the schema while
   the new code is still running would break claiming immediately (Prisma would error on
   every query referencing a dropped column). Roll back code and schema in the same
   deploy, not as two separate steps.
4. No reservation/credit data needs manual reconciliation as part of this specific
   rollback — the new fields never carry the authoritative record of a reservation's
   state (that's still `CreditReservation.status`, unchanged by this migration).

## 6. Read-only diagnostics

Same spirit as `OPERATIONS.md` §12a's existing diagnostics, extended for the new states:

```sql
-- Jobs currently retrying (queued again after a worker crash, not yet reclaimed)
SELECT id, "projectId", "attemptCount", "maxAttempts", "notBeforeAt"
FROM "Job"
WHERE status = 'queued' AND "attemptCount" > 0
ORDER BY "notBeforeAt" ASC;

-- Dead-lettered jobs (exhausted retries) -- for manual review, not automated action
SELECT id, "projectId", "attemptCount", "deadLetteredAt", log
FROM "Job"
WHERE status = 'dead_letter'
ORDER BY "deadLetteredAt" DESC;

-- A processing job whose lease looks stale right now (would be caught by the next
-- reconciliation pass, or already has been -- read-only, do not act on this directly)
SELECT id, "projectId", "workerId", "leaseExpiresAt", "heartbeatAt"
FROM "Job"
WHERE status = 'processing' AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" < now());
```
