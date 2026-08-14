/**
 * Media output fencing: prevent stale workers from exposing incorrect video.
 *
 * Design:
 * - Every render uploads to an attempt-scoped key: jobs/{jobId}/attempts/{attemptToken}/{filename}
 * - attemptToken is minted fresh by claimNextQueuedJob() on every claim, so a crashed/retried
 *   attempt never reuses a previous attempt's key -- there is no cross-attempt collision to
 *   resolve and therefore no rename/promotion step against object storage.
 * - The attempt-scoped key becomes the permanent Project.videoUrl only if the runner's
 *   completion transaction wins the lease-fenced updateMany({ workerId, attemptToken }) check
 *   (see script-runner.ts / repurpose-runner.ts / ugc-runner.ts). A losing/stale attempt's
 *   object is left orphaned in storage under its own attempt prefix -- it is never linked
 *   from any Project row, so it is never served to a customer.
 * - This intentionally avoids claiming "atomic" behavior across object storage and Postgres:
 *   the upload and the database write are two separate operations against two systems that
 *   do not share a transaction. Correctness instead comes from key uniqueness (only the
 *   winning attempt's key is ever referenced) rather than from a cross-system atomic rename.
 */

export function getAttemptMediaKey(jobId: string, attemptToken: string, filename: string): string {
  return `jobs/${jobId}/attempts/${attemptToken}/${filename}`;
}
