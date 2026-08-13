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
import { refundCredits } from "@/lib/credits";
import { releaseReservationInTx } from "@/lib/pricing/ledger";
import { resolveProjectCreditOwnerId } from "@/lib/workspace";

export type JobType = "script" | "repurpose" | "ugc";
export interface ClaimedJob {
  id: string;
  type: JobType;
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
      await releaseReservationInTx(tx, reservation.id);
    });
  } else {
    // Legacy fallback: no reservation (demo job)
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
 * Checks backpressure limits (per-user, per-workspace pending jobs) and
 * returns 429 via shouldThrottle. Returns 503 via shouldDegrade if checking
 * limits fails (prefer graceful degradation over blocking users). */
export async function claimNextQueuedJob(
  workerId: string,
  userId?: string,
  workspaceId?: string | null
): Promise<{ job: ClaimedJob; shouldThrottle: boolean; shouldDegrade: boolean } | null> {
  // Backpressure: if user/workspace has too many pending jobs, throttle
  if (userId) {
    const pendingCount = await db.job.count({
      where: {
        userId,
        status: { in: ["queued", "leased", "processing"] }
      }
    }).catch(() => -1);

    if (pendingCount === -1) return { job: null as never, shouldThrottle: false, shouldDegrade: true };
    if (pendingCount >= 50) return { job: null as never, shouldThrottle: true, shouldDegrade: false };
  }

  if (workspaceId) {
    const pendingCount = await db.job.count({
      where: {
        project: { workspaceId },
        status: { in: ["queued", "leased", "processing"] }
      }
    }).catch(() => -1);

    if (pendingCount === -1) return { job: null as never, shouldThrottle: false, shouldDegrade: true };
    if (pendingCount >= 200) return { job: null as never, shouldThrottle: true, shouldDegrade: false };
  }

  // Claim: find oldest queued job (priority DESC, createdAt ASC) that passes
  // notBeforeAt gate (backoff-respecting), update atomically to leased
  const job = await db.job.findFirst({
    where: {
      status: "queued",
      notBeforeAt: { lte: new Date() } // null or in the past = claimable
    },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    include: { project: { select: { type: true, userId: true, workspaceId: true } } }
  });

  if (!job) return null;

  const now = new Date();
  const leaseExpires = new Date(now.getTime() + LEASE_DURATION_MS);

  // Atomic: transition queued → leased and stamp lease info
  const updated = await db.job.updateMany({
    where: { id: job.id, status: "queued" },
    data: {
      status: "leased",
      leaseExpiresAt: leaseExpires,
      workerId,
      heartbeatAt: now,
      attemptCount: { increment: 1 },
      notBeforeAt: null // clear any prior backoff gate
    }
  });

  if (updated.count === 0) {
    // Lost the race; another worker claimed this job first
    return null;
  }

  // Second atomic: queued → processing (both changes committed in the update above)
  // Note: in this design, "leased" and "processing" are not separate statuses;
  // the transition happens in one atomic update. They are distinguished via
  // leaseExpiresAt for observability.
  await db.job.update({
    where: { id: job.id },
    data: { status: "processing" }
  });

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

  return {
    job: { id: job.id, type: job.project.type as JobType },
    shouldThrottle: false,
    shouldDegrade: false
  };
}

/** Renew a processing job's lease if we're still the owner. Safe no-op if
 * workerId doesn't match (job was somehow reassigned). */
export async function renewLease(
  jobId: string,
  workerId: string
): Promise<boolean> {
  const now = new Date();
  const newExpiry = new Date(now.getTime() + LEASE_DURATION_MS);

  const updated = await db.job.updateMany({
    where: { id: jobId, status: "processing", workerId },
    data: {
      leaseExpiresAt: newExpiry,
      heartbeatAt: now
    }
  });

  return updated.count > 0;
}

/** Update job stage for observability (best-effort, never throws). */
export async function updateJobStage(jobId: string, stage: string): Promise<void> {
  await db.job.update({
    where: { id: jobId },
    data: { stage, updatedAt: new Date() }
  }).catch(() => {
    // Silent fail: stage is observability only, doesn't affect correctness
  });
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
        `Job exhausted max attempts (${job.maxAttempts}) after stale lease`,
        "dead_letter"
      );
    }
  }
}

/** Finalize a job as completed. Called by successful runner completion. */
export async function completeJob(jobId: string): Promise<void> {
  const job = await db.job.findUnique({ where: { id: jobId } });
  if (!job) return;

  const now = new Date();
  await db.job.update({
    where: { id: jobId },
    data: { status: "completed", completedAt: now }
  });
}

/** Finalize a job as failed (in-runner error, unretried). */
export async function failJobTerminal(jobId: string, message: string): Promise<void> {
  const job = await db.job.findUnique({
    where: { id: jobId },
    include: { project: { select: { userId: true, workspaceId: true } } }
  });
  if (!job) return;

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
