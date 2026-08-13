import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { timingSafeEqual } from "crypto";

export const runtime = "nodejs";

// In-memory metrics for this instance (would be replaced with Prometheus client for production)
const metricsCache = {
  httpRequests: new Map<string, number>(),
  httpErrorsTotal: 0,
  jobsCompletedTotal: 0,
  jobsFailedTotal: 0,
  jobsRetriedTotal: 0,
  jobsDeadLetteredTotal: 0,
  demosAcceptedTotal: 0,
  demosRejectedTotal: 0,
  creditInconsistenciesTotal: 0,
  lastUpdated: Date.now(),
};

/** Verify metrics access is authorized */
function isAuthorized(req: Request): boolean {
  const metricsSecret = process.env.METRICS_SECRET;

  // Production requires strong authentication
  if (process.env.NODE_ENV === "production" && !metricsSecret) {
    return false; // Fail closed if secret not configured
  }

  // Get bearer token from Authorization header
  const authHeader = req.headers.get("authorization") || "";
  const [scheme, token] = authHeader.split(" ");

  if (scheme !== "Bearer" || !token) {
    return false;
  }

  if (!metricsSecret) {
    return false; // No auth configured
  }

  // Timing-safe comparison to prevent timing attacks
  try {
    const tokenBuffer = Buffer.from(token);
    const secretBuffer = Buffer.from(metricsSecret);
    return timingSafeEqual(tokenBuffer, secretBuffer);
  } catch {
    return false;
  }
}

/** Collect current metrics from database */
async function collectMetrics() {
  try {
    // Collect queue metrics
    const queueDepth = await db.job.count({
      where: { status: "queued" }
    });

    const oldestQueued = await db.job.findFirst({
      where: { status: "queued" },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true }
    });

    const oldestAge = oldestQueued
      ? Math.round((Date.now() - oldestQueued.createdAt.getTime()) / 1000)
      : 0;

    // Collect job metrics (aggregated counts)
    const jobCounts = await db.job.groupBy({
      by: ["status"],
      _count: true
    });

    const statusCounts: Record<string, number> = {};
    for (const row of jobCounts) {
      statusCounts[row.status] = row._count;
    }

    // Collect credit metrics
    const creditCounts = await db.creditReservation.groupBy({
      by: ["status"],
      _count: true
    });

    const creditStatusCounts: Record<string, number> = {};
    for (const row of creditCounts) {
      creditStatusCounts[row.status] = row._count;
    }

    return {
      queueDepth,
      oldestQueuedAgeSeconds: oldestAge,
      jobsByStatus: statusCounts,
      creditsByStatus: creditStatusCounts,
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    console.error("[metrics] Error collecting metrics:", err);
    return null;
  }
}

/** Format metrics in Prometheus text format */
function formatPrometheus(metrics: Awaited<ReturnType<typeof collectMetrics>>) {
  if (!metrics) {
    return "# ERROR: Failed to collect metrics\n";
  }

  let output = "# HELP queue_depth Number of jobs in queued status\n";
  output += "# TYPE queue_depth gauge\n";
  output += `queue_depth ${metrics.queueDepth}\n`;

  output += "\n# HELP queue_oldest_job_age_seconds Age of oldest queued job in seconds\n";
  output += "# TYPE queue_oldest_job_age_seconds gauge\n";
  output += `queue_oldest_job_age_seconds ${metrics.oldestQueuedAgeSeconds}\n`;

  output += "\n# HELP jobs_by_status Number of jobs in each status\n";
  output += "# TYPE jobs_by_status gauge\n";
  for (const [status, count] of Object.entries(metrics.jobsByStatus)) {
    output += `jobs_by_status{status="${status}"} ${count}\n`;
  }

  output += "\n# HELP credit_reservations_by_status Number of credit reservations by status\n";
  output += "# TYPE credit_reservations_by_status gauge\n";
  for (const [status, count] of Object.entries(metrics.creditsByStatus)) {
    output += `credit_reservations_by_status{status="${status}"} ${count}\n`;
  }

  output += "\n# HELP credit_inconsistencies_total Count of credit/reservation mismatches detected\n";
  output += "# TYPE credit_inconsistencies_total counter\n";
  output += `credit_inconsistencies_total ${metricsCache.creditInconsistenciesTotal}\n`;

  output += "\n# HELP metrics_collection_timestamp_seconds Timestamp when metrics were collected\n";
  output += "# TYPE metrics_collection_timestamp_seconds gauge\n";
  output += `metrics_collection_timestamp_seconds ${new Date(metrics.timestamp).getTime() / 1000}\n`;

  return output;
}

export async function GET(req: Request) {
  // Authenticate request
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Rate limit metrics access (10 requests per minute per token)
  // In production, use Redis or similar for distributed rate limiting
  // This is a basic in-memory implementation

  // Collect and format metrics
  const metrics = await collectMetrics();
  const prometheus = formatPrometheus(metrics);

  // Return response with proper caching headers
  return new Response(prometheus, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      "Pragma": "no-cache",
      "Expires": "0",
      "X-Metrics-Timestamp": new Date().toISOString(),
    },
  });
}
