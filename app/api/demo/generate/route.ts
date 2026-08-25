import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getClientIp } from "@/lib/rate-limit";
import { getDemoUserId } from "@/lib/demo-user";
import { JOB_PRIORITY_DEMO } from "@/lib/jobs/claim";
import { checkAndReserveDemoQuota } from "@/lib/demo/quota";

export const runtime = "nodejs";

const MIN_TOPIC_LENGTH = 10;
const MAX_TOPIC_LENGTH = 300;

// Anonymous, unauthenticated, and running on shared free-tier providers —
// this can't be gated by credits like a real account, so it leans entirely
// on the persistent per-IP + global quota (lib/demo/quota.ts) plus a hard
// concurrency cap (below) to keep the render queue's real capacity
// (WORKER_CONCURRENCY=1 as of Phase 3 -- see worker/index.ts) available for
// actual paying/signed-up users. Quota is DB-backed, not in-memory: it must
// survive an app restart and stay correct across multiple app replicas,
// neither of which an in-process counter can do.
const MAX_CONCURRENT_DEMO_JOBS = 1;
// Arbitrary but must stay constant and distinct from lib/workers/admission.ts's
// ADMISSION_LOCK_KEY and lib/demo/quota.ts's DEMO_QUOTA_LOCK_KEY (unrelated
// critical sections -- sharing a key would needlessly serialize this
// concurrent-job-count check against either of those).
const DEMO_ADMISSION_LOCK_KEY = 419_662_003n;

/** Kill switch for the whole anonymous demo feature -- e.g. if provider spend
 * spikes or the demo queue is starving paid customers. Defaults to enabled
 * (unset = "true") so this is a strict opt-out, not a behavior change for an
 * unconfigured environment. */
function isDemoEnabled(): boolean {
  return process.env.DEMO_GENERATION_ENABLED !== "false";
}

export async function POST(req: Request) {
  if (!isDemoEnabled()) {
    return NextResponse.json(
      { error: "Free demos are temporarily unavailable — sign up free to generate videos with your own credits." },
      { status: 503 }
    );
  }

  const ip = getClientIp(req);
  // Single atomic check+reserve against BOTH the per-IP and global daily
  // limits (lib/demo/quota.ts) -- a true result already recorded this
  // submission; there is no separate "now count it" step, so a request that
  // fails admission below (concurrency cap) still correctly counts against
  // today's quota rather than getting a free retry.
  const quota = await checkAndReserveDemoQuota(ip);
  if (!quota.allowed) {
    // Distinguish "your IP" vs "everyone" for a clearer message, without
    // parsing the reason string -- reason always starts with one of these.
    const isPerIp = quota.reason.startsWith("Demo limit for your IP");
    return NextResponse.json(
      {
        error: isPerIp
          ? "You've used your free demos for today — sign up free for unlimited generations."
          : "Free demos have hit today's company-wide limit — sign up free for unlimited generations.",
      },
      { status: isPerIp ? 429 : 503 }
    );
  }

  const body = await req.json().catch(() => null);
  const topic = typeof body?.topic === "string" ? body.topic.trim() : "";
  if (topic.length < MIN_TOPIC_LENGTH || topic.length > MAX_TOPIC_LENGTH) {
    return NextResponse.json(
      { error: `Give us a bit more to work with (${MIN_TOPIC_LENGTH}-${MAX_TOPIC_LENGTH} characters).` },
      { status: 400 }
    );
  }

  const demoUserId = await getDemoUserId();

  // The count-check and the job insert below must be atomic w.r.t. each
  // other, or two requests arriving close together both read "0 active" and
  // both proceed -- same class of check-then-act race as worker admission
  // (lib/workers/admission.ts), fixed the same way: a transaction-scoped
  // advisory lock forces the second caller's count to wait for the first
  // caller's insert to commit. Distinct lock key from ADMISSION_LOCK_KEY
  // (unrelated critical section -- must not serialize against it).
  const result = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${DEMO_ADMISSION_LOCK_KEY})`;

    const activeDemoJobs = await tx.job.count({
      where: { userId: demoUserId, status: { in: ["queued", "processing"] } },
    });
    if (activeDemoJobs >= MAX_CONCURRENT_DEMO_JOBS) {
      return { admitted: false as const };
    }

    const project = await tx.project.create({
      data: {
        userId: demoUserId,
        type: "script",
        title: topic.slice(0, 60),
        status: "queued",
        input: JSON.stringify({ topic, watermark: true, freeOnly: true }),
      },
    });

    // priority: JOB_PRIORITY_DEMO -- demos must never outrank a paying
    // customer's job in the claim order (section 13 of the scale-readiness
    // brief). See lib/jobs/claim.ts's claimNextQueuedJob, which orders by
    // priority DESC before createdAt ASC.
    await tx.job.create({
      data: { userId: demoUserId, projectId: project.id, type: "render", status: "queued", priority: JOB_PRIORITY_DEMO },
    });

    return { admitted: true as const, projectId: project.id };
  });

  if (!result.admitted) {
    return NextResponse.json(
      { error: "High demand right now — give it a minute and try again." },
      { status: 429 }
    );
  }

  // No local enqueue step -- the worker process picks up this queued job
  // on its own poll loop (see worker/index.ts, lib/jobs/claim.ts).
  return NextResponse.json({ projectId: result.projectId });
}
