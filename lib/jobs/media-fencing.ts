/**
 * Media output fencing: prevent stale workers from exposing incorrect video.
 *
 * Design:
 * - All renders upload to attempt-scoped temporary keys: jobs/{jobId}/attempts/{attemptToken}/output.mp4
 * - Only the worker that wins the fenced completion transaction (verifies lease ownership) can
 *   promote its attempt output to the final Project.videoUrl
 * - Stale workers' uploaded objects remain in object storage but are never referenced or exposed
 * - Cleanup removes abandoned attempt objects but never removes the winning output
 * - Promotion is idempotent: if already promoted, re-calling succeeds without error
 */

import { db } from "@/lib/db";

export class MediaPromotionError extends Error {
  constructor(jobId: string, attemptToken: string) {
    super(`Cannot promote media for job ${jobId}: lease lost or already promoted by another attempt`);
    this.name = "MediaPromotionError";
  }
}

/**
 * Generate the attempt-scoped temporary media key. Used during rendering before lease
 * is verified. Example: jobs/job-123/attempts/abc-def-ghi/output.mp4
 */
export function getAttemptMediaKey(jobId: string, attemptToken: string, filename: string): string {
  return `jobs/${jobId}/attempts/${attemptToken}/${filename}`;
}

/**
 * Generate the final media key used in Project.videoUrl. Example: jobs/job-123/output.mp4
 * This is the only key that should ever be exposed to customers.
 */
export function getFinalMediaKey(jobId: string, filename: string = "output.mp4"): string {
  return `jobs/${jobId}/${filename}`;
}

/**
 * Promote attempt media to final Project.videoUrl, only if this attempt still owns the job.
 * MUST be called INSIDE the fenced completion transaction to ensure atomicity:
 * - Verify job still owned (status=processing, workerId, attemptToken match)
 * - Update Job status to done
 * - Update Project.videoUrl to final key
 * - Capture credits
 * ALL TOGETHER or NONE at all.
 *
 * Returns true if promotion succeeded, false if lease was lost.
 * On lease loss, caller must throw LeaseLostError to abort transaction.
 */
export async function promoteAttemptMediaInTx(
  tx: any, // Prisma transaction client
  jobId: string,
  projectId: string,
  workerId: string,
  attemptToken: string,
  finalMediaKey: string
): Promise<boolean> {
  // Verify this attempt still owns the job (will only succeed if update found a matching row)
  const updated = await tx.job.updateMany({
    where: { id: jobId, status: "processing", workerId, attemptToken },
    data: { videoUrl: finalMediaKey }
  });

  // If update returned 0, job was already finalized by another worker (or lease lost)
  if (updated.count === 0) {
    return false;
  }

  // Promotion succeeded - final media key is now visible in Project
  return true;
}

/**
 * Check if media has already been promoted to final for this job.
 * Used for idempotency: if re-calling after a crash, we can detect that
 * this attempt's work already succeeded and skip re-uploading.
 */
export async function isMediaPromoted(jobId: string, finalMediaKey: string): Promise<boolean> {
  const job = await db.job.findUnique({
    where: { id: jobId },
    select: { videoUrl: true }
  });
  return job?.videoUrl === finalMediaKey;
}

/**
 * List all attempt objects for cleanup. Returns array of attempt-scoped keys that should be deleted.
 * Deliberately excludes the final key to prevent accidental deletion of the active output.
 */
export async function listAbandonedAttemptKeys(
  jobId: string,
  finalMediaKey: string,
  allAttemptKeys: string[] // provided by caller (typically from object-storage list-prefix)
): Promise<string[]> {
  // Keep only attempt-scoped keys that are not the final key
  return allAttemptKeys.filter(
    (key) =>
      key.startsWith(`jobs/${jobId}/attempts/`) && // must be this job's attempt scope
      !key.endsWith(finalMediaKey) // must not be the final key
  );
}
