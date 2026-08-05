/** Simple in-memory fixed-window rate limiter — sufficient for a single-instance
 * deployment. Keyed by an arbitrary string (usually route + client IP). */

const buckets = new Map<string, { count: number; resetAt: number }>();

// Prevent unbounded growth from one-off keys (e.g. many distinct IPs) by
// periodically dropping expired entries.
function sweep(now: number) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}
let lastSweep = 0;

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  resetAt: number;
}

export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  if (now - lastSweep > windowMs) {
    sweep(now);
    lastSweep = now;
  }

  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    const resetAt = now + windowMs;
    buckets.set(key, { count: 1, resetAt });
    return { ok: true, remaining: limit - 1, resetAt };
  }

  if (existing.count >= limit) {
    return { ok: false, remaining: 0, resetAt: existing.resetAt };
  }

  existing.count += 1;
  return { ok: true, remaining: limit - existing.count, resetAt: existing.resetAt };
}

/** Best-effort client IP from standard proxy headers, falling back to a shared
 * bucket if none is present (e.g. direct connections without a proxy in front). */
export function getClientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp;
  return "unknown";
}
