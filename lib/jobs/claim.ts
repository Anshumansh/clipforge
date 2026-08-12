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

function isJobType(value: string): value is JobType {
  return value === "script" || value === "repurpose" || value === "ugc";
}

/** Marks one job/project failed and releases its reservation (or falls
 * back to a legacy refund) -- used for the defensive "claimed a job whose
 * project has an unrecognized type" branch below. Mirrors the atomic
 * failure path every runner implements for its own internal errors (see
 * lib/jobs/script-runner.ts and releaseReservationInTx in
 * lib/pricing/ledger.ts): for a reservation-backed job, Job failed +
 * Project failed + reservation released + balance restored + refund
 * ledger entry all commit in one transaction or not at all. */
async function failClaimedJob(job: { id: string; projectId: string }, message: string): Promise<void> {
  const reservation = await db.creditReservation.findUnique({ where: { jobId: job.id } }).catch(() => null);

  if (reservation) {
    await db
      .$transaction(async (tx) => {
        await tx.job.update({ where: { id: job.id }, data: { status: "failed", log: message } });
        await tx.project.update({ where: { id: job.projectId }, data: { status: "failed", errorMessage: message } });
        await releaseReservationInTx(tx, reservation.id, message);
      })
      .catch((e) => {
        // No fallback writes -- if the transaction failed, nothing
        // committed, so this job is untouched (still "processing",
        // reservation still "reserved"). The next worker startup's
        // reconciliation will find and finalize it.
        console.error(
          `[claim] atomic failure finalization failed for job ${job.id} -- it remains recoverable as processing/reserved:`,
          e instanceof Error ? e.message : e
        );
      });
  } else {
    // Legacy/demo fallback: no reservation, use the older, non-atomic
    // charge/refund mechanism -- same acknowledged gap as the runners'
    // failure paths (see lib/jobs/script-runner.ts).
    await db.job.update({ where: { id: job.id }, data: { status: "failed", log: message } });
    await db.project.update({ where: { id: job.projectId }, data: { status: "failed", errorMessage: message } });
    const project = await db.project.findUnique({ where: { id: job.projectId }, select: { userId: true, workspaceId: true } });
    if (project) {
      const creditOwnerId = await resolveProjectCreditOwnerId(project).catch(() => project.userId);
      await refundCredits(creditOwnerId, CREDITS_PER_VIDEO).catch((e) =>
        console.error(`[claim] legacy credit refund failed for job ${job.id}:`, e instanceof Error ? e.message : e)
      );
    }
  }
}

/**
 * Attempts to claim exactly one queued job. Returns null if there's
 * nothing to claim right now, or if a race for the same candidate row was
 * lost to a concurrent claimer (safe to call again on the next poll tick --
 * this is not an error).
 *
 * The dispatch type comes from Project.type ("script" | "repurpose" |
 * "ugc"), not a separate Job column -- that's the one piece of information
 * the old in-memory queue carried that the DB didn't durably record on its
 * own, and it turns out it didn't need to: every generation route already
 * sets Project.type to exactly this value at creation time, so it's fully
 * recoverable via the existing Job -> Project relation. No schema change
 * was needed for this.
 */
export async function claimNextQueuedJob(): Promise<ClaimedJob | null> {
  const candidate = await db.job.findFirst({
    where: { status: "queued" },
    orderBy: { createdAt: "asc" },
    select: { id: true, projectId: true, project: { select: { type: true } } },
  });
  if (!candidate) return null;

  // The actual exclusivity guarantee -- see the module doc comment above.
  const result = await db.job.updateMany({
    where: { id: candidate.id, status: "queued" },
    data: { status: "processing" },
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
    await failClaimedJob(
      { id: candidate.id, projectId: candidate.projectId },
      `Unrecognized project type "${type}" -- cannot dispatch to a runner`
    );
    return null;
  }

  return { id: candidate.id, type };
}

/**
 * Recovers jobs left "processing" by a crashed worker process. Does NOT
 * touch "queued" jobs -- a queued job is valid, not-yet-started pending
 * work on the durable DB-backed queue (Phase 3), not an orphan. It was
 * only ever orphaned by the OLD in-memory queue (deleted in this phase),
 * which reset on every process restart and had no other way to recover a
 * job it had merely accepted but not yet started. The new poll loop
 * (claimNextQueuedJob) picks up "queued" jobs on its own, on the very next
 * tick, with no help needed from this function -- calling this
 * "reconcileOrphanedJobs" (its Phase 3 name) would now be actively
 * misleading, since it no longer treats "queued" as orphaned at all.
 *
 * SINGLE-WORKER ASSUMPTION -- read before changing the deployment: this
 * function treats every job it finds "processing" as abandoned by A PRIOR
 * CRASH OF THIS SAME WORKER ROLE, and unconditionally fails + refunds it.
 * That's correct when at most one worker process is ever running against
 * this database (this phase's supported deployment -- see WORKER_REPLICAS
 * in OPERATIONS.md and the startup log in worker/index.ts). It is NOT safe
 * if a second, healthy worker is concurrently running and legitimately
 * still processing one of these jobs -- this function has no way to
 * distinguish "abandoned by a crash" from "another live worker is still on
 * it," and would incorrectly fail/refund a job out from under a worker
 * that's still doing real work on it.
 *
 * This is a deliberate, documented limitation, not an oversight: a correct
 * multi-worker version needs an ownership/lease mechanism (claimedBy +
 * heartbeat + expiry, or equivalent) to tell "abandoned" apart from
 * "actively owned by a live peer," which requires a schema change. That's
 * out of scope for this phase (single-worker only, per the Phase 3 brief).
 *
 * Must be called ONCE, at worker process startup, before the poll loop
 * begins claiming new work -- never at web-process startup. Anything
 * already "processing" in the DB at that moment is guaranteed to be from a
 * previous worker process (this call happens before this worker instance
 * has claimed anything), so it's safe to fail outright rather than guess
 * at resuming a render that's already gone.
 *
 * A job that reached "done" is never touched here, by construction: the
 * final "ready"/"done"/capture transition is one atomic DB transaction
 * (see lib/jobs/script-runner.ts and captureReservationInTx in
 * lib/pricing/ledger.ts), so a job is never observable as "done" with its
 * reservation still "reserved" -- there is no crash window that leaves a
 * "done" job needing rescue by this function.
 *
 * Finalization is atomic PER JOB (Phase 3.2 hardening, 2026-08-12): for
 * each abandoned job that has a CreditReservation, Job failed + Project
 * failed + reservation released + balance restored + refund ledger entry
 * all commit in one db.$transaction, or none of them do (see
 * releaseReservationInTx in lib/pricing/ledger.ts). Before this pass, Job/
 * Project were marked failed in bulk first and reservations released in a
 * separate loop afterward -- a crash between those two phases could leave
 * a "failed" job whose reservation was still "reserved" forever, exactly
 * the class of bug captureReservationInTx already closed on the success
 * side. Each job's transaction is independent, so one job's DB failure
 * (logged, left as "processing"/"reserved" for the next reconciliation
 * pass to retry) never blocks any other job in the same batch from being
 * finalized.
 */
export async function reconcileAbandonedProcessingJobs(): Promise<void> {
  const abandoned = await db.job.findMany({
    where: { status: "processing" },
    select: {
      id: true,
      projectId: true,
      // userId + workspaceId are the two fields resolveProjectCreditOwnerId
      // needs to find the right account to refund -- workspace member
      // projects must refund to the owner, not the member who triggered
      // the render.
      project: { select: { userId: true, workspaceId: true } },
    },
  });
  if (abandoned.length === 0) return;

  const message = "Interrupted by a worker restart -- please try again.";
  let finalized = 0;

  for (const job of abandoned) {
    const reservation = await db.creditReservation.findUnique({ where: { jobId: job.id } }).catch(() => null);

    if (reservation) {
      // Exact-once: releaseReservationInTx is a no-op (and explicitly
      // refuses to refund) if this reservation was already captured -- see
      // releaseReservationInTx in lib/pricing/ledger.ts. Defense in depth:
      // given the query above only ever selects "processing" jobs, and
      // success only ever transitions a job straight to "done" together
      // with capture in one transaction, this function should never
      // actually observe a "processing" job whose reservation is already
      // "captured" -- but the exact-once guard means it's harmless even if
      // it somehow did.
      await db
        .$transaction(async (tx) => {
          await tx.job.update({ where: { id: job.id }, data: { status: "failed", log: message } });
          await tx.project.update({ where: { id: job.projectId }, data: { status: "failed", errorMessage: message } });
          await releaseReservationInTx(tx, reservation.id, message);
        })
        .then(() => {
          finalized++;
        })
        .catch((e) => {
          // No fallback writes -- if the transaction failed, nothing
          // committed, so this job is untouched (still "processing",
          // reservation still "reserved"). That is the safe, recoverable
          // state: the next worker startup's reconciliation pass will try
          // again. Writing a partial "failed" status without the matching
          // release would recreate the exact bug this pass closes.
          console.error(
            `[claim] atomic reconciliation failed for job ${job.id} -- it remains recoverable as processing/reserved:`,
            e instanceof Error ? e.message : e
          );
        });
    } else {
      // Legacy/demo fallback: no reservation, use the older, non-atomic
      // charge/refund mechanism -- same acknowledged, pre-existing gap as
      // the runners' failure paths (see lib/jobs/script-runner.ts). Not
      // part of this hardening pass.
      await db.job.update({ where: { id: job.id }, data: { status: "failed", log: message } }).catch((e) =>
        console.error(`[claim] failed to mark abandoned job ${job.id} as failed:`, e instanceof Error ? e.message : e)
      );
      await db.project
        .update({ where: { id: job.projectId }, data: { status: "failed", errorMessage: message } })
        .catch((e) => console.error(`[claim] failed to mark project for job ${job.id} as failed:`, e instanceof Error ? e.message : e));
      const creditOwnerId = await resolveProjectCreditOwnerId(job.project).catch(() => job.project.userId);
      await refundCredits(creditOwnerId, CREDITS_PER_VIDEO).catch((e) =>
        console.error(`[claim] legacy credit refund failed for abandoned job ${job.id}:`, e instanceof Error ? e.message : e)
      );
      finalized++;
    }
  }

  console.error(`[claim] reconciled ${finalized}/${abandoned.length} abandoned processing job(s) from a previous worker process`);
}
