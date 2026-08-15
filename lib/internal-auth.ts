import crypto from "node:crypto";

/** Timing-safe comparison of a provided secret against an expected one --
 * hashes both sides to a fixed-length digest first, both to avoid a
 * length-mismatch throw from `timingSafeEqual` and to avoid the byte-count
 * timing leak of a raw `===`. Shared by every internal shared-secret check
 * in this codebase (cron, worker-to-app media fetch) rather than
 * duplicated per call site. */
export function timingSafeSecretEquals(expected: string | undefined, provided: string | null): boolean {
  if (!expected || !provided) return false;
  const expectedHash = crypto.createHash("sha256").update(expected).digest();
  const providedHash = crypto.createHash("sha256").update(provided).digest();
  return crypto.timingSafeEqual(expectedHash, providedHash);
}

/** Identifies the render worker fetching a job's own source media
 * server-to-server (e.g. downloading an uploaded repurpose source video
 * for local analysis, lib/providers/subject-tracking.ts's
 * prepareLocalSource) -- a plain unauthenticated `fetch()` with no user
 * session to check. The worker and app share one `.env` (docker-compose.yml),
 * so this doesn't grant the worker anything it doesn't already have via
 * direct DB access -- it's a trust-boundary marker for the HTTP hop, not a
 * new privilege. */
export function isValidInternalMediaSecret(provided: string | null): boolean {
  return timingSafeSecretEquals(process.env.INTERNAL_MEDIA_SECRET, provided);
}
