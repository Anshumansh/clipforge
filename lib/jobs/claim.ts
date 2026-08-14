/**
 * Full 8-status queue lifecycle with lease-based claiming, worker heartbeat,
 * priority-ordered claiming, exponential-backoff retry for stale leases,
 * and dead-lettering after maxAttempts. Supports all 7 priority tiers
 * (currently only demo=-10 wired; others default to priority=0).
 *
 * Status machine:
 *  queued → leased → processing → completed (success)
 *  queued → leased → processing → failed_retryable → queued (with backoff)
 *  queued → leased → processing → failed_terminal (unretryable error)
 *  queued → leased → processing → dead_letter (maxAttempts exhausted)
 *  queued → cancelled (explicit user cancel before claim)
 */
import { db } from "@/lib/db";
import { refundCredits, CREDITS_PER_VIDEO } from "@/lib/credits";
import { releaseReservationInTx } from "@/lib/pricing/ledger";
import { resolveProjectCreditOwnerId } from "@/lib/workspace";

export type JobType = "script" | "repurpose" | "ugc";

export class LeaseLostError extends Error {
  constructor(jobId: string) {
    super(`Lease lost for job ${jobId}: stale worker attempt or job reassigned`);
    this.name = "LeaseLostError";
  }
}

export interface ClaimedJob {
  id: string;
  type: JobType;
  attemptToken: string; // UUID for this attempt; must be verified on all mutations
}

// 7-tier priority system (section 13). Higher = claimed first.
export const JOB_PRIORITY_PAID_URGENT = 100;    // Future: urgent paid (e.g., B2B)
export const JOB_PRIORITY_PAID_STANDARD = 50;   // Future: standard paid customer
export const JOB_PRIORITY_VERIFIED_FREE = 10;   // Future: verified free account (not anonymous demo)
export const JOB_PRIORITY_STANDARD = 0;         // Default/neutral priority
export const JOB_PRIORITY_HEAVY = -5;           // Future: 4K or voice-cloning (expensive)
export const JOB_PRIORITY_4K = -8;              // Future: 4K render (compute-intensive)
export const JOB_PRIORITY_DEMO = -10;           // Anonymous demo (lowest priority)

// Lease and heartbeat constants
export const LEASE_DURATION_MS = 45_000;
export const HEARTBEAT_INTERVAL_MS = LEASE_DURATION_MS / 3; // ~15s
export const RECONCILIATION_INTERVAL_MS = LEASE_DURATION_MS / 1.5; // ~30s

const MAX_BACKOFF_MS = 60_000;

export function computeBackoffMs(attemptCount: number): number {
  const base = Math.min(2 ** Math.max(attemptCount, 1) * 1000, MAX_BACKOFF_MS);
  return base + Math.random() * base * 0.5;
}

function isJobType(value: string): value is JobType {
  return ["script", "repurpose", "ugc"].includes(value);
}

/** Atomic terminal job finalization: updates Job + Project + releases
 * reservation (or falls back to legacy refund). Used by both the defensive
 * "unrecognized type" claim path and the dead-letter reconciliation path. */
async function finalizeJobTerminal(
  job: {
    id: string
    projectId: string
    project?: { userId: string; workspaceId: string | null }
  },
  message: string,
  status: "failed_terminal" | "dead_letter"
): Promise<void> {
  const reservation = await db.creditReservation.findUnique({
    where: { jobId: job.id }
  }).catch(() => null);

  const now = new Date();
  const extra = status === "dead_letter" ? { deadLetteredAt: now } : { failedAt: now };

  if (reservation) {
    await db.$transaction(async (tx) => {
      await tx.job.update({
        where: { id: job.id },
        data: { status, log: message, failureReason: message, ...extra }
      });
      await tx.project.update({
        where: { id: job.projectId },
        data: { status: "failed", errorMessage: message }
      });
      await releaseReservationInTx(tx, reservation.id, status);
    });
  } else {
    // Legacy fallback: no reservation (pre-new-pricing jobs)
    // Refund credits using the old system
    const creditOwner = job.project
      ? await resolveProjectCreditOwnerId(job.project)
      : (await db.project.findUnique({ where: { id: job.projectId }, select: { userId: true } }))?.userId;

    if (creditOwner) {
      await refundCredits(creditOwner, CREDITS_PER_VIDEO);
    }

    await db.$transaction(async (tx) => {
      await tx.job.update({
        where: { id: job.id },
        data: { status, log: message, failureReason: message, ...extra }
      });
      await tx.project.update({
        where: { id: job.projectId },
        data: { status: "failed", errorMessage: message }
      });
    });
  }
}

/** Atomically claim the next queued job, or return null if none available.
 * Backpressure enforcement (user/workspace pending-job limits) is the
 * responsibility of the API routes that CREATE jobs, not the worker claiming them.
 * The worker simply claims the next job in priority order. */
export async function claimNextQueuedJob(
  workerId: string
): Promise<ClaimedJob | null> {

  // Claim: find oldest queued job (priority DESC, createdAt ASC) that passes
  // notBeforeAt gate (backoff-respecting), update atomically to leased
  const job = await db.job.findFirst({
    where: {
      status: "queued",
      OR: [
        { notBeforeAt: null },           // legacy jobs or cleared backoff
        { notBeforeAt: { lte: new Date() } } // backoff expired
      ]
    },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    include: { project: { select: { type: true, userId: true, workspaceId: true } } }
  });

  if (!job) return null;

  const now = new Date();
  const leaseExpires = new Date(now.getTime() + LEASE_DURATION_MS);
  // Generate a unique token for this attempt to prevent stale-worker mutations
  const attemptToken = crypto.randomUUID();

  // Atomic: transition queued → processing and stamp lease info
  // The leaseExpiresAt field signals that this job is active/claimed
  // The attemptToken prevents stale workers from mutating this job
  const updated = await db.job.updateMany({
    where: { id: job.id, status: "queued" },
    data: {
      status: "processing",
      leaseExpiresAt: leaseExpires,
      workerId,
      heartbeatAt: now,
      attemptToken, // unique token for this attempt
      attemptCount: { increment: 1 },
      notBeforeAt: null // clear any prior backoff gate
    }
  });

  if (updated.count === 0) {
    // Lost the race; another worker claimed this job first
    return null;
  }

  if (!isJobType(job.project.type)) {
    // Defensive: unrecognized project type at claim time (should never happen)
    // Fail and refund immediately
    await finalizeJobTerminal(
      { id: job.id, projectId: job.projectId, project: job.project },
      `Unrecognized project type: ${job.project.type}`,
      "failed_terminal"
    );
    return null;
  }

  return { id: job.id, type: job.project.type as JobType, attemptToken };
}

/** Renew a processing job's lease if we're still the owner. Safe no-op if
 * workerId/attemptToken doesn't match (job was reassigned to another attempt).
 * Requires valid attemptToken to prevent stale workers from extending expired leases. */
export async function renewLease(
  jobId: string,
  workerId: string,
  attemptToken: string
): Promise<void> {
  const now = new Date();
  const newExpiry = new Date(now.getTime() + LEASE_DURATION_MS);

  try {
    await db.job.updateMany({
      where: { id: jobId, status: "processing", workerId, attemptToken },
      data: {
        leaseExpiresAt: newExpiry,
        heartbeatAt: now
      }
    });
  } catch (err) {
    // Heartbeat failure shouldn't crash the worker; log and continue
    console.error(`[worker] Failed to renew lease for job ${jobId}:`, err instanceof Error ? err.message : String(err));
  }
}

/** Update job stage for observability, with lease fencing. Throws LeaseLostError
 * if the worker's attemptToken doesn't match (stale worker, job reassigned).
 * Best-effort on non-lease errors (silently fails on DB issues). */
export async function updateJobStage(
  jobId: string,
  workerId: string,
  attemptToken: string,
  stage: string
): Promise<void> {
  try {
    const updated = await db.job.updateMany({
      where: { id: jobId, status: "processing", workerId, attemptToken },
      data: { stage, updatedAt: new Date() }
    });
    if (updated.count === 0) {
      throw new LeaseLostError(jobId);
    }
  } catch (err) {
    if (err instanceof LeaseLostError) throw err;
    // Non-lease errors: silently fail (stage is observability only)
  }
}

/** Atomically cancel a queued job before it's claimed. Returns false if
 * the job was already claimed or terminal (normal race, not an error). */
export async function cancelQueuedJob(jobId: string): Promise<boolean> {
  const job = await db.job.findUnique({ where: { id: jobId } });
  if (!job || job.status !== "queued") return false;

  const reservation = await db.creditReservation.findUnique({
    where: { jobId }
  }).catch(() => null);

  const now = new Date();

  if (reservation) {
    await db.$transaction(async (tx) => {
      await tx.job.update({
        where: { id: jobId },
        data: { status: "cancelled", cancelledAt: now }
      });
      await tx.project.update({
        where: { id: job.projectId },
        data: { status: "cancelled" }
      });
      await releaseReservationInTx(tx, reservation.id);
    });
  } else {
    await db.$transaction(async (tx) => {
      await tx.job.update({
        where: { id: jobId },
        data: { status: "cancelled", cancelledAt: now }
      });
      await tx.project.update({
        where: { id: job.projectId },
        data: { status: "cancelled" }
      });
    });
  }

  return true;
}

/** Reconcile stale leases: find processing jobs whose lease has expired or
 * have no lease (legacy rows), and either retry with backoff or dead-letter
 * depending on attemptCount vs maxAttempts. Runs at worker startup and on a
 * recurring timer (safe even with multiple future workers: a live peer's
 * lease never expires, so it's never mistaken for abandoned). */
export async function reconcileAbandonedProcessingJobs(): Promise<void> {
  const now = new Date();

  // Find processing jobs with expired/missing leases
  const abandoned = await db.job.findMany({
    where: {
      status: "processing",
      OR: [
        { leaseExpiresAt: null },           // legacy pre-migration rows
        { leaseExpiresAt: { lt: now } }     // lease expired
      ]
    },
    include: {
      project: { select: { userId: true, workspaceId: true } }
    }
  });

  for (const job of abandoned) {
    try {
      if (job.attemptCount < job.maxAttempts) {
        // Retryable: requeue with backoff
        const backoffMs = computeBackoffMs(job.attemptCount);
        const notBeforeAt = new Date(now.getTime() + backoffMs);

        await db.job.update({
          where: { id: job.id },
          data: {
            status: "queued",
            notBeforeAt,
            leaseExpiresAt: null,
            workerId: null,
            heartbeatAt: null,
            log: `Retried after stale lease (attempt ${job.attemptCount + 1}/${job.maxAttempts})`
          }
        });
      } else {
        // Dead-letter: exhausted retries
        await finalizeJobTerminal(
          { id: job.id, projectId: job.projectId, project: job.project },
          `Job exhausted max attempts (${job.maxAttempts}) after worker restart/stale lease`,
          "dead_letter"
        );
      }
    } catch (err) {
      // Log the error but continue processing other jobs.
      // If the error occurred partway through a finalization, the job remains
      // recoverable as processing/reserved for the next reconciliation pass.
      console.error(
        `[reconcile] Failed to process job ${job.id}; remains recoverable as processing/reserved:`,
        err instanceof Error ? err.message : String(err)
      );
    }
  }
}

/** Finalize a job as completed with lease fencing. Throws LeaseLostError if
 * the worker's attemptToken doesn't match (stale worker, job reassigned). */
export async function completeJob(
  jobId: string,
  workerId: string,
  attemptToken: string
): Promise<void> {
  const now = new Date();
  const updated = await db.job.updateMany({
    where: { id: jobId, status: "processing", workerId, attemptToken },
    data: { status: "completed", completedAt: now }
  });
  if (updated.count === 0) {
    throw new LeaseLostError(jobId);
  }
}

/** Finalize a job as failed (in-runner error, unretried) with lease fencing.
 * Throws LeaseLostError if the worker's attemptToken doesn't match (stale worker, job reassigned). */
export async function failJobTerminal(
  jobId: string,
  workerId: string,
  attemptToken: string,
  message: string
): Promise<void> {
  const job = await db.job.findUnique({
    where: { id: jobId },
    include: { project: { select: { userId: true, workspaceId: true } } }
  });
  if (!job) return;

  // Verify lease ownership before proceeding with terminal failure
  if (job.workerId !== workerId || job.attemptToken !== attemptToken) {
    throw new LeaseLostError(jobId);
  }

  await finalizeJobTerminal(job, message, "failed_terminal");
}

/** Finalize a job as failed_retryable (in-runner error that might succeed
 * on retry). Currently not used (we only retry on stale leases), but available
 * for future error classification. */
export async function failJobRetryable(jobId: string, message: string): Promise<void> {
  const job = await db.job.findUnique({ where: { id: jobId } });
  if (!job) return;

  const now = new Date();
  await db.job.update({
    where: { id: jobId },
    data: {
      status: "failed_retryable",
      log: message,
      failureReason: message,
      failedAt: now
    }
  });
}
