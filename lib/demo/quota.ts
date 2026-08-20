/**
 * Persistent demo job quota enforcement. Tracks demo submissions per IP
 * address and enforces both per-IP and global daily limits, backed by the
 * database so counts survive an app restart and are shared correctly across
 * multiple app replicas (an in-memory counter is neither).
 *
 * Both limits are checked and recorded atomically in a single transaction,
 * serialized per calendar day via a Postgres advisory lock -- this is the
 * same pattern app/api/demo/generate/route.ts already uses for its own
 * concurrent-job-count admission check, just a distinct lock key (must never
 * share a key with an unrelated critical section, or the two would
 * needlessly serialize against each other for no correctness reason).
 *
 * Wiring history: this module existed as a correct, individually-tested
 * primitive (see quota.integration.test.ts) that no route ever called --
 * app/api/demo/generate/route.ts enforced limits via an in-memory counter
 * instead (lib/rate-limit.ts), which doesn't persist across restarts or
 * aggregate across replicas. This is now the one, single source of truth;
 * the in-memory path has been removed from the demo route entirely.
 */
import { db } from "@/lib/db";
import type { Prisma, PrismaClient } from "@prisma/client";
import { CREDITS_PER_VIDEO } from "@/lib/credits";

// Configuration from environment, read fresh on every call (functions, not
// frozen top-level consts) -- matches the re-readable-env-var convention
// already established in this codebase (worker/index.ts's
// readWorkerConfigFromEnv()), and is what makes each of these independently
// testable per-call rather than fixed at module-import time. Defaults match
// the values already live in production before this migration (route.ts's
// own hardcoded DEMO_LIMIT_PER_IP_PER_DAY=3 and getDemoGlobalLimitPerDay()'s
// default of 200) -- changing the defaults here would have silently
// loosened the real limit rather than just fixing where it's enforced.
export function getDemoPerIpLimit(): number {
  const raw = Number(process.env.DEMO_PER_IP_LIMIT ?? "3");
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 3;
}
export function getDemoGlobalLimitPerDay(): number {
  const raw = Number(process.env.DEMO_GLOBAL_LIMIT_PER_DAY ?? "200");
  return Number.isFinite(raw) && raw > 0 ? raw : 200;
}
export const DEMO_CREDITS_TO_DOLLARS = Number(process.env.DEMO_CREDITS_TO_DOLLARS ?? "0.1"); // $0.10 per credit

// Distinct from DEMO_ADMISSION_LOCK_KEY (app/api/demo/generate/route.ts,
// unrelated critical section: concurrent-job-count, not quota) and from
// ADMISSION_LOCK_KEY (lib/workers/admission.ts, worker admission). Arbitrary
// but must stay constant.
const DEMO_QUOTA_LOCK_KEY = 719_004_221n;

/** Get the UTC date (00:00:00 UTC) for quota tracking. */
function getUtcDate(now = new Date()): Date {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const date = now.getUTCDate();
  return new Date(Date.UTC(year, month, date, 0, 0, 0, 0));
}

/** Anonymize IP for privacy (keep only the network prefix, not the full
 * address) -- the raw IP is never written to the database. */
function anonymizeIp(ip: string): string {
  if (ip.includes(".") && !ip.includes(":")) {
    const octets = ip.split(".");
    return `${octets[0]}.${octets[1]}.${octets[2]}.0/24`;
  }
  if (ip.includes(":")) {
    const parts = ip.split(":");
    return `${parts.slice(0, 4).join(":")}.../64`;
  }
  return ip; // fallback -- unrecognized format, kept as-is rather than dropped
}

export type DemoQuotaResult = { allowed: true } | { allowed: false; reason: string };

/**
 * Atomically checks and, if allowed, records one demo submission against
 * both the per-IP and global daily limits. Fully race-free: both checks and
 * the increment happen inside one transaction serialized by an advisory
 * lock, so N concurrent requests from the same IP (or racing against the
 * global cap) can never together exceed either limit -- unlike a naive
 * check-then-increment, a rejected request never touches the stored count.
 *
 * Callers must not call this and then separately decide whether to proceed;
 * a true return IS the reservation.
 */
export async function checkAndReserveDemoQuota(ipAddress: string): Promise<DemoQuotaResult> {
  try {
    return await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${DEMO_QUOTA_LOCK_KEY})`;

      const anonymizedIp = anonymizeIp(ipAddress);
      const utcDate = getUtcDate();
      const estimatedCostPerDemo = CREDITS_PER_VIDEO * DEMO_CREDITS_TO_DOLLARS;

      const perIpLimit = getDemoPerIpLimit();
      const globalLimit = getDemoGlobalLimitPerDay();

      const ipQuota = await tx.demoQuota.findUnique({
        where: { ipAddress_utcDate: { ipAddress: anonymizedIp, utcDate } },
      });
      if (ipQuota && ipQuota.submissionCount >= perIpLimit) {
        return { allowed: false, reason: `Demo limit for your IP (${perIpLimit} per day) exceeded` };
      }

      const globalStats = await tx.demoQuota.aggregate({
        where: { utcDate },
        _sum: { estimatedCost: true },
      });
      const totalCostToday = (globalStats._sum.estimatedCost ?? 0) + estimatedCostPerDemo;
      if (totalCostToday > globalLimit) {
        return { allowed: false, reason: `Daily demo budget limit ($${globalLimit}/day) would be exceeded` };
      }

      // Both checks passed inside the same locked transaction -- record the
      // submission now. A rejected request above never reaches this write,
      // so the stored count can never overshoot either limit.
      await tx.demoQuota.upsert({
        where: { ipAddress_utcDate: { ipAddress: anonymizedIp, utcDate } },
        update: {
          submissionCount: { increment: 1 },
          estimatedCost: { increment: estimatedCostPerDemo },
          lastUpdated: new Date(),
        },
        create: {
          ipAddress: anonymizedIp,
          utcDate,
          submissionCount: 1,
          estimatedCost: estimatedCostPerDemo,
        },
      });

      return { allowed: true };
    });
  } catch (err) {
    console.error("[demo-quota] check-and-reserve failed:", err instanceof Error ? err.message : err);
    // Fail open: if the database is unreachable, allow the demo rather than
    // hard-down the whole feature over a transient DB blip. Matches the
    // existing fail-open convention for this specific check elsewhere in
    // the codebase (isDemoEnabled()'s kill switch is the hard stop for
    // deliberate shutoffs; this is only for unexpected infra failure).
    return { allowed: true };
  }
}

/**
 * Get current quota stats for a given IP address (today only). Used for
 * user-facing feedback ("X/N demos used today").
 */
export async function getDemoQuotaStats(ipAddress: string) {
  try {
    const anonymizedIp = anonymizeIp(ipAddress);
    const utcDate = getUtcDate();

    const quota = await db.demoQuota.findUnique({
      where: { ipAddress_utcDate: { ipAddress: anonymizedIp, utcDate } },
      select: { submissionCount: true, estimatedCost: true, lastUpdated: true },
    });

    return {
      submissionCount: quota?.submissionCount ?? 0,
      estimatedCost: quota?.estimatedCost ?? 0,
      limit: getDemoPerIpLimit(),
      lastUpdated: quota?.lastUpdated,
    };
  } catch (err) {
    console.error("[demo-quota] stats lookup failed:", err instanceof Error ? err.message : err);
    return { submissionCount: 0, estimatedCost: 0, limit: getDemoPerIpLimit() };
  }
}

/**
 * Clean up old quota records (older than 7 days). Run periodically to keep
 * the table size reasonable. Called by cron.
 */
export async function cleanupStaleQuotas(daysOld = 7): Promise<number> {
  try {
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - daysOld);
    const cutoffDate = getUtcDate(cutoff);

    const result = await db.demoQuota.deleteMany({
      where: { utcDate: { lt: cutoffDate } },
    });

    console.log(`[demo-quota] cleaned up ${result.count} old records`);
    return result.count;
  } catch (err) {
    console.error("[demo-quota] cleanup failed:", err instanceof Error ? err.message : err);
    return 0;
  }
}

// Re-exported so tests/tooling that used the transaction-client type
// elsewhere can reference it without importing @prisma/client directly.
export type DemoQuotaTx = Prisma.TransactionClient;
export type { PrismaClient };
