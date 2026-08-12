/**
 * Phase 3 (production stability / render worker isolation, 2026-08-12):
 * database-backed job claiming + crash reconciliation, replacing the
 * in-memory FIFO queue that used to live in lib/jobs/queue.ts and run
 * inside the Next.js web process itself.
 *
 * Claiming is a conditional UPDATE, not a SELECT ... FOR UPDATE or an
 * explicit advisory lock: `db.job.updateMany({ where: { id, status:
 * "queued" }, data: { status: "processing" } })`. Postgres serializes
 * concurrent UPDATEs against the same row -- under READ COMMITTED (the
 * default, and what Prisma/Postgres use here), a second UPDATE targeting a
 * row another still-uncommitted UPDATE just touched BLOCKS until the first
 * commits, then re-evaluates its own WHERE clause against the now-current
 * row. Once the first winner's UPDATE has committed status="processing",
 * every other concurrent UPDATE's `status = "queued"` predicate no longer
 * matches, so their `updateMany` reports `count: 0`. No explicit
 * transaction wrapper or row-lock hint is needed for this guarantee -- it's
 * the same "WHERE-guarded conditional write, check the affected count"
 * pattern this codebase already uses for balance-guarded credit updates in
 * lib/pricing/ledger.ts's reserveCredits().
 *
 * Queue-lifecycle hardening (scale/100-user-readiness branch, 2026-08-13):
 * claiming now also sets a lease (leaseExpiresAt/workerId/heartbeatAt), so a
 * FUTURE multi-worker deployment can tell "abandoned by a crash" apart from
 * "a live peer is still working on it" -- the single-worker limitation
 * documented below on reconcileAbandonedProcessingJobs is about to be
 * loosened, not removed: the lease mechanism is necessary but this file
 * still only *needs* to be correct for one worker today, since nothing
 * currently runs a second one. Ordering is now priority-first (demo jobs
 * get a negative priority so a paid job queued after a burst of demos still
 * claims ahead of them -- see PRIORITY constants below), and a stale lease
 * is retried with backoff up to Job.maxAttempts before being dead-lettered,
 * instead of unconditionally failing on first sight.
 */
import { db } from "@/lib/db";
import { refundCredits, CREDITS_PER_VIDEO } from "@/lib/credits";
import { releaseReservationInTx } from "@/lib/pricing/ledger";
import { resolveProjectCreditOwnerId } from "@/lib/workspace";

export type JobType = "script" | "repurpose" | "ugc";

export interface ClaimedJob {
  id: string;
  type: JobType;
}

/** Priority tiers (section 13 of the scale-readiness brief). Higher claims
 * first. Only demo is wired to a non-default value today -- the brief's
 * fuller 7-tier system (paid-priority / standard / free / demo / heavy /
 * 4K / voice-cloning) needs those workflow classifications threaded through
 * every job-creation call site, which is real, separate follow-up work; this
 * is the one tier where "demos must never outrank a paying customer" is both
 * unambiguous and already fully wireable today. */
export const JOB_PRIORITY_STANDARD = 0;
export const JOB_PRIORITY_DEMO = -10;

/** How long a claimed job's lease is valid without a heartbeat renewal.
 * Must comfortably exceed the heartbeat interval a live worker renews on
 * (worker/index.ts) -- a healthy worker renews well before this expires; if
 * it doesn't, something is genuinely wrong (crash, hang, kill -9) and the
 * job is safe to reclaim. */
export const LEASE_DURATION_MS = 45_000;

const MAX_BACKOFF_MS = 60_000;

/** Exponential backoff with jitter for a retried job's notBeforeAt --
 * attempt 1 -> ~2-3s, attempt 2 -> ~4-6s, attempt 3 -> ~8-12s, capped at
 * MAX_BACKOFF_MS, so a job that keeps needing retries backs off rather than
 * spinning in a tight claim-fail-claim loop. */
export function computeBackoffMs(attemptCount: number): number {
  const base = Math.min(2 ** Math.max(attemptCount, 1) * 1000, MAX_BACKOFF_MS);
  return base + Math.random() * base * 0.5;
}

function isJobType(value: string): value is JobType {
  return value === "script" || value === "repurpose" || value === "ugc";
}

/** Marks one job/project terminally failed and releases its reservation (or
 * falls back to a legacy refund) -- the shared atomic finalization used by
 * both the defensive "unrecognized project type" claim path below and
 * reconcileAbandonedProcessingJobs' dead-letter path. Mirrors the atomic
 * failure path every runner implements for its own internal errors (see
 * lib/jobs/script-runner.ts and releaseReservationInTx in
 * lib/pricing/ledger.ts): for a reservation-backed job, Job status +
 * Project failed + reservation released + balance restored + refund
 * ledger entry all commit in one transaction or not at all. */
async function finalizeJobTerminal(
  job: { id: string; projectId: string; project?: { userId: string; workspaceId: string | null } },
  message: string,
  status: "failed" | "dead_letter"
): Promise<void> {
  const reservation = await db.creditReservation.findUnique({ where: { jobId: job.id } }).catch(() => null);
  const extra = status === "dead_letter" ? { deadLetteredAt: new Date() } : {};

  if (reservation) {
    await db
      .$transaction(async (tx) => {
        await tx.job.update({ where: { id: job.id }, data: { status, log: message, ...extra } });
        await tx.project.update({ where: { id: job.projectId }, data: { status: "failed", errorMessage: message } });
        await releaseReservationInTx(tx, reservation.id, message);
      })
      .catch((e) => {
        // No fallback writes -- if the transaction failed, nothing
        // committed, so this job is untouched (still "processing",
        // reservation still "reserved"). The next reconciliation pass
        // will find and finalize it.
        console.error(
          `[claim] atomic failure finalization failed for job ${job.id} -- it remains recoverable as processing/reserved:`,
          e instanceof Error ? e.message : e
        );
      });
  } else {
    // Legacy/demo fallback: no reservation, use the older, non-atomic
    // charge/refund mechanism -- same acknowledged gap as the runners'
    // failure paths (see lib/jobs/script-runner.ts). Use the caller's
    // already-fetched project (reconcileAbandonedProcessingJobs' query
    // already selects it) rather than a redundant findUnique -- only
    // claimNextQueuedJob's defensive branch doesn't have it in scope, so
    // only that caller needs the fallback fetch below.
    await db.job.update({ where: { id: job.id }, data: { status, log: message, ...extra } });
    await db.project.update({ where: { id: job.projectId }, data: { status: "failed", errorMessage: message } });
    const project = job.project ?? (await db.project.findUnique({ where: { id: job.projectId }, select: { userId: true, workspaceId: true } }));
    if (project) {
      const creditOwnerId = await resolveProjectCreditOwnerId(project).catch(() => project.userId);
      await refundCredits(creditOwnerId, CREDITS_PER_VIDEO).catch((e) =>
        console.error(`[claim] legacy credit refund failed for job ${job.id}:`, e instanceof Error ? e.message : e)
      );
    }
  }
}

/**
 * Attempts to claim exactly one queued job, ordered by priority (highest
 * first) then age (oldest first) within a priority tier. Returns null if
 * there's nothing claimable right now (either the queue is empty, or every
 * queued job is backing off after a retry and not yet past its
 * notBeforeAt), or if a race for the same candidate row was lost to a
 * concurrent claimer (safe to call again on the next poll tick -- this is
 * not an error).
 *
 * The dispatch type comes from Project.type ("script" | "repurpose" |
 * "ugc"), not a separate Job column -- that's the one piece of information
 * the old in-memory queue carried that the DB didn't durably record on its
 * own, and it turns out it didn't need to: every generation route already
 * sets Project.type to exactly this value at creation time, so it's fully
 * recoverable via the existing Job -> Project relation. No schema change
 * was needed for this.
 *
 * `workerId` identifies which worker instance now holds the lease -- see
 * worker/index.ts's `instanceId`. Used for observability and so a future
 * multi-worker deployment's heartbeat renewal can confirm it's still
 * renewing its own lease, not one reassigned elsewhere.
 */
export async function claimNextQueuedJob(workerId: string): Promise<ClaimedJob | null> {
  const now = new Date();
  const candidate = await db.job.findFirst({
    where: { status: "queued", OR: [{ notBeforeAt: null }, { notBeforeAt: { lte: now } }] },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    select: { id: true, projectId: true, project: { select: { type: true } } },
  });
  if (!candidate) return null;

  // The actual exclusivity guarantee -- see the module doc comment above.
  const result = await db.job.updateMany({
    where: { id: candidate.id, status: "queued" },
    data: {
      status: "processing",
      leaseExpiresAt: new Date(now.getTime() + LEASE_DURATION_MS),
      workerId,
      heartbeatAt: now,
      attemptCount: { increment: 1 },
    },
  });
  if (result.count === 0) {
    // Lost the race for this exact row to a concurrent claimer. Only
    // meaningful once more than one worker exists (not this phase's
    // supported deployment -- see the single-worker note on
    // reconcileAbandonedProcessingJobs below), but safe and correct
    // regardless.
    return null;
  }

  const type = candidate.project.type;
  if (!isJobType(type)) {
    // Defensive: every current creation path (script/repurpose/ugc routes,
    // the demo route) sets Project.type to one of the three known values,
    // so this should be unreachable in practice. If it ever happens anyway
    // (a future project type added without updating this dispatch table,
    // or a data anomaly), fail the job explicitly rather than crash the
    // worker's poll loop or silently drop a claimed-but-unrunnable job.
    // Not retried -- an unrecognized type will never become recognized on
    // its own, so retrying would just waste attempts.
    await finalizeJobTerminal(
      { id: candidate.id, projectId: candidate.projectId },
      `Unrecognized project type "${type}" -- cannot dispatch to a runner`,
      "failed"
    );
    return null;
  }

  return { id: candidate.id, type };
}

/** Renews the lease on a job the caller is actively processing -- called
 * periodically (see worker/index.ts) while a claimed job is in flight, so a
 * live worker's lease never goes stale. Guarded by both status="processing"
 * and a matching workerId: if this job was somehow reclaimed by someone
 * else (shouldn't happen in the single-worker deployment this still
 * targets, but the guard costs nothing and is exactly the check a future
 * multi-worker rollout needs), this becomes a safe no-op rather than
 * incorrectly extending a lease that's no longer this caller's to hold. */
export async function renewLease(jobId: string, workerId: string): Promise<void> {
  await db.job
    .updateMany({
      where: { id: jobId, status: "processing", workerId },
      data: { leaseExpiresAt: new Date(Date.now() + LEASE_DURATION_MS), heartbeatAt: new Date() },
    })
    .catch((e) => {
      // Heartbeat renewal failing is not fatal to the in-flight render --
      // log and continue; if it never manages to renew before the lease
      // expires, reconciliation treats it exactly like a crashed worker
      // (safe, if slightly premature, outcome).
      console.error(`[claim] lease renewal failed for job ${jobId}:`, e instanceof Error ? e.message : e);
    });
}

/** Updates the current processing stage shown in job status polling (see
 * ProjectStatus / /api/projects/[id]). Best-effort, non-blocking -- a
 * failed stage update should never interrupt an in-flight render. */
export async function updateJobStage(jobId: string, stage: string): Promise<void> {
  await db.job.update({ where: { id: jobId }, data: { stage } }).catch(() => {});
}

/**
 * Recovers jobs left "processing" with a stale or missing lease -- either a
 * legacy row from before this migration (leaseExpiresAt is null, since the
 * column didn't exist yet) or one whose lease has genuinely expired because
 * nothing has renewed it (crash, hang, kill -9). Does NOT touch "queued"
 * jobs -- a queued job is valid, not-yet-started pending work on the
 * durable DB-backed queue, not an orphan.
 *
 * Retry-with-backoff: a job below its maxAttempts is requeued (status back
 * to "queued", notBeforeAt pushed out by computeBackoffMs, lease fields
 * cleared) rather than immediately failed -- a stale lease means the WORKER
 * died, which says nothing about whether the job's own input is bad, so
 * auto-retrying here is always safe (unlike retrying an error thrown
 * *inside* a runner's own generation logic, which this function does not
 * do -- see the runners' catch blocks, which stay immediately terminal on
 * purpose: retrying an unclassified in-runner error could mean burning
 * attempts, and real provider cost, retrying something that will never
 * succeed). A job at or above maxAttempts is dead-lettered instead, using
 * the same atomic reservation-release transaction the "failed" path always
 * used.
 *
 * SINGLE-WORKER ASSUMPTION -- read before changing the deployment: the
 * lease mechanism makes this function *safe* to run alongside a live peer
 * (their leases won't have expired), but this codebase still only supports
 * one worker process in practice -- claimNextQueuedJob has no ownership
 * transfer protocol beyond the lease itself (no explicit "hand off" or
 * "steal" semantics), and nothing else in this phase has been tested under
 * real concurrent multi-worker load. Treat this as the foundation a real
 * multi-worker rollout would build on, not a claim that one is supported
 * today.
 *
 * Must be called at worker startup (before the poll loop begins claiming
 * new work) AND periodically while running (a lease can expire mid-run,
 * not just be stale at startup) -- see worker/index.ts.
 *
 * A job that reached "done" is never touched here, by construction: the
 * final "ready"/"done"/capture transition is one atomic DB transaction
 * (see lib/jobs/script-runner.ts and captureReservationInTx in
 * lib/pricing/ledger.ts), so a job is never observable as "done" with its
 * reservation still "reserved" -- there is no crash window that leaves a
 * "done" job needing rescue by this function.
 */
export async function reconcileAbandonedProcessingJobs(): Promise<void> {
  const now = new Date();
  const abandoned = await db.job.findMany({
    where: { status: "processing", OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }] },
    select: {
      id: true,
      projectId: true,
      attemptCount: true,
      maxAttempts: true,
      // userId + workspaceId are the two fields resolveProjectCreditOwnerId
      // needs to find the right account to refund -- workspace member
      // projects must refund to the owner, not the member who triggered
      // the render.
      project: { select: { userId: true, workspaceId: true } },
    },
  });
  if (abandoned.length === 0) return;

  const message = "Interrupted by a worker restart -- please try again.";
  let requeued = 0;
  let deadLettered = 0;

  for (const job of abandoned) {
    const attemptCount = job.attemptCount || 1;
    const maxAttempts = job.maxAttempts || 3;

    if (attemptCount < maxAttempts) {
      // Retryable: requeue with backoff. Does not touch the reservation --
      // it's still legitimately in flight, and Project.status stays
      // whatever it already was (still "processing" from the user's
      // perspective; the retry is invisible to them unless it eventually
      // exhausts attempts).
      await db.job
        .update({
          where: { id: job.id },
          data: {
            status: "queued",
            log: `Retrying after a worker restart (attempt ${attemptCount}/${maxAttempts})`,
            notBeforeAt: new Date(now.getTime() + computeBackoffMs(attemptCount)),
            leaseExpiresAt: null,
            workerId: null,
            heartbeatAt: null,
            stage: null,
          },
        })
        .then(() => {
          requeued++;
        })
        .catch((e) =>
          console.error(`[claim] failed to requeue abandoned job ${job.id} for retry:`, e instanceof Error ? e.message : e)
        );
      continue;
    }

    // Exhausted retries -- dead-letter, atomically releasing the
    // reservation exactly once (or falling back to legacy refund for a
    // no-reservation job), same pattern as before this pass, just under
    // the "dead_letter" status instead of "failed" so it's distinguishable
    // from a job that failed for an in-runner reason on its very first and
    // only attempt.
    await finalizeJobTerminal(job, message, "dead_letter")
      .then(() => {
        deadLettered++;
      })
      .catch(() => {
        // finalizeJobTerminal already logs its own failure and leaves the
        // job safely recoverable -- nothing more to do here.
      });
  }

  console.error(
    `[claim] reconciliation: ${requeued} job(s) requeued for retry, ${deadLettered} dead-lettered, out of ${abandoned.length} with a stale/missing lease`
  );
}

/** Cancels a job that is still "queued" (never claimed) -- atomically marks
 * it cancelled, marks its project cancelled... no, "failed" (Project has no
 * "cancelled" status of its own yet, so this reuses "failed" with a
 * cancellation-specific message, same as any other terminal outcome the
 * dashboard already knows how to render), and releases its reservation
 * exactly once. Deliberately does NOT support cancelling a job that's
 * already "processing" -- safely interrupting an in-flight Remotion/
 * Chromium/ffmpeg render (without either leaking the child process or
 * racing the runner's own success/failure finalization) needs a
 * cancellation signal threaded through the runner itself, which is real,
 * separate follow-up work, not implemented this pass. Returns false (no-op)
 * if the job is no longer queued (already claimed, already terminal, or
 * doesn't exist) -- the caller should treat that as "too late to cancel",
 * not an error. */
export async function cancelQueuedJob(jobId: string): Promise<boolean> {
  const job = await db.job.findUnique({ where: { id: jobId }, select: { projectId: true } });
  if (!job) return false;

  const reservation = await db.creditReservation.findUnique({ where: { jobId } }).catch(() => null);
  const message = "Cancelled before rendering started.";

  if (reservation) {
    let cancelled = false;
    await db
      .$transaction(async (tx) => {
        const result = await tx.job.updateMany({
          where: { id: jobId, status: "queued" },
          data: { status: "cancelled", cancelledAt: new Date(), log: message },
        });
        if (result.count === 0) return; // already claimed/terminal -- nothing to cancel
        await tx.project.update({ where: { id: job.projectId }, data: { status: "failed", errorMessage: message } });
        await releaseReservationInTx(tx, reservation.id, message);
        cancelled = true;
      })
      .catch((e) => console.error(`[claim] cancellation failed for job ${jobId}:`, e instanceof Error ? e.message : e));
    return cancelled;
  }

  const result = await db.job.updateMany({
    where: { id: jobId, status: "queued" },
    data: { status: "cancelled", cancelledAt: new Date(), log: message },
  });
  if (result.count === 0) return false;
  await db.project.update({ where: { id: job.projectId }, data: { status: "failed", errorMessage: message } }).catch(() => {});
  return true;
}
