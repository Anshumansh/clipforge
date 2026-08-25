/**
 * Persistent demo job quota enforcement. Tracks demo submissions per IP address
 * and enforces both per-IP and global daily limits. Quotas are stored in the
 * database so they survive application restarts (unlike the previous in-memory approach).
 *
 * Estimated cost is calculated based on CREDITS_PER_VIDEO and a conversion rate.
 * Global daily limit is enforced based on total estimated cost.
 */
import { db } from "@/lib/db";
import { CREDITS_PER_VIDEO } from "@/lib/credits";

// Configuration from environment
export const DEMO_PER_IP_LIMIT = Number(process.env.DEMO_PER_IP_LIMIT ?? "30");
export const DEMO_GLOBAL_LIMIT_PER_DAY = Number(process.env.DEMO_GLOBAL_LIMIT_PER_DAY ?? "100");
export const DEMO_CREDITS_TO_DOLLARS = Number(process.env.DEMO_CREDITS_TO_DOLLARS ?? "0.1"); // $0.10 per credit
export const DEMO_KILL_SWITCH = process.env.DEMO_KILL_SWITCH === "true";

/** Get the UTC date (00:00:00 UTC) for quota tracking. */
function getUtcDate(now = new Date()): Date {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const date = now.getUTCDate();
  return new Date(Date.UTC(year, month, date, 0, 0, 0, 0));
}

/** Anonymize IP for privacy (keep only the network prefix, not full address). */
function anonymizeIp(ip: string): string {
  // For IPv4: keep first 3 octets + mask last octet
  if (ip.includes(".") && !ip.includes(":")) {
    const octets = ip.split(".");
    return `${octets[0]}.${octets[1]}.${octets[2]}.0/24`;
  }
  // For IPv6: keep first 64 bits (simplified)
  if (ip.includes(":")) {
    const parts = ip.split(":");
    return `${parts.slice(0, 4).join(":")}.../64`;
  }
  return ip; // fallback
}

/**
 * Check if a demo submission is allowed under the quota. Returns {allowed, reason}.
 * Also enforces the demo kill switch (if enabled, always reject).
 */
export async function checkDemoQuota(
  ipAddress: string
): Promise<{ allowed: boolean; reason?: string }> {
  // Kill switch: block all demos if enabled
  if (DEMO_KILL_SWITCH) {
    return { allowed: false, reason: "Demo submissions are currently disabled" };
  }

  try {
    const anonymizedIp = anonymizeIp(ipAddress);
    const utcDate = getUtcDate();
    const estimatedCostPerDemo = CREDITS_PER_VIDEO * DEMO_CREDITS_TO_DOLLARS;

    // Check per-IP limit
    const ipQuota = await db.demoQuota.findUnique({
      where: { ipAddress_utcDate: { ipAddress: anonymizedIp, utcDate } },
    });

    if (ipQuota && ipQuota.submissionCount >= DEMO_PER_IP_LIMIT) {
      return {
        allowed: false,
        reason: `Demo limit for your IP (${DEMO_PER_IP_LIMIT} per day) exceeded`,
      };
    }

    // Check global daily limit
    const globalStats = await db.demoQuota.aggregate({
      where: { utcDate },
      _sum: { estimatedCost: true },
      _count: true,
    });

    const totalCostToday = (globalStats._sum.estimatedCost ?? 0) + estimatedCostPerDemo;
    if (totalCostToday > DEMO_GLOBAL_LIMIT_PER_DAY) {
      return {
        allowed: false,
        reason: `Daily demo budget limit ($${DEMO_GLOBAL_LIMIT_PER_DAY}/day) would be exceeded`,
      };
    }

    return { allowed: true };
  } catch (err) {
    console.error("[demo-quota] check failed:", err instanceof Error ? err.message : err);
    // Fail open: if the DB is down, allow the demo to proceed (graceful degradation)
    // The quota check will succeed next time the DB recovers
    return { allowed: true };
  }
}

/**
 * Atomically increment the demo quota for an IP address.
 * Called after a demo submission is successfully validated/accepted.
 * Returns true if incremented successfully, false if quota was exceeded
 * (concurrent submission race).
 */
export async function incrementDemoQuota(ipAddress: string): Promise<boolean> {
  try {
    const anonymizedIp = anonymizeIp(ipAddress);
    const utcDate = getUtcDate();
    const estimatedCostPerDemo = CREDITS_PER_VIDEO * DEMO_CREDITS_TO_DOLLARS;

    // Upsert: if the quota doesn't exist, create it with count=1
    // if it exists and count < limit, increment; otherwise update last_updated
    const result = await db.demoQuota.upsert({
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

    // Double-check we didn't exceed the limit (defensive)
    if (result.submissionCount > DEMO_PER_IP_LIMIT) {
      console.warn(
        `[demo-quota] concurrent submission exceeded per-IP limit for ${anonymizedIp}: ${result.submissionCount} > ${DEMO_PER_IP_LIMIT}`
      );
      return false;
    }

    return true;
  } catch (err) {
    console.error("[demo-quota] increment failed:", err instanceof Error ? err.message : err);
    // Fail closed: if we can't update the quota, reject the submission
    return false;
  }
}

/**
 * Get current quota stats for a given IP address (today only).
 * Used for user-facing feedback ("X/30 demos used today").
 */
export async function getDemoQuotaStats(ipAddress: string) {
  try {
    const anonymizedIp = anonymizeIp(ipAddress);
    const utcDate = getUtcDate();

    const quota = await db.demoQuota.findUnique({
      where: { ipAddress_utcDate: { ipAddress: anonymizedIp, utcDate } },
      select: {
        submissionCount: true,
        estimatedCost: true,
        lastUpdated: true,
      },
    });

    return {
      submissionCount: quota?.submissionCount ?? 0,
      estimatedCost: quota?.estimatedCost ?? 0,
      limit: DEMO_PER_IP_LIMIT,
      lastUpdated: quota?.lastUpdated,
    };
  } catch (err) {
    console.error("[demo-quota] stats lookup failed:", err instanceof Error ? err.message : err);
    return { submissionCount: 0, estimatedCost: 0, limit: DEMO_PER_IP_LIMIT };
  }
}

/**
 * Clean up old quota records (older than 7 days).
 * Run this periodically to keep the table size reasonable.
 * Called by cron job or during maintenance.
 */
export async function cleanupStaleQuotas(daysOld = 7): Promise<number> {
  try {
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - daysOld);
    const cutoffDate = getUtcDate(cutoff);

    const result = await db.demoQuota.deleteMany({
      where: {
        utcDate: { lt: cutoffDate },
      },
    });

    console.log(`[demo-quota] cleaned up ${result.count} old records`);
    return result.count;
  } catch (err) {
    console.error("[demo-quota] cleanup failed:", err instanceof Error ? err.message : err);
    return 0;
  }
}
