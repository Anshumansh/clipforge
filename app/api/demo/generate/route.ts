import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { getDemoUserId } from "@/lib/demo-user";
import { JOB_PRIORITY_DEMO } from "@/lib/jobs/claim";

export const runtime = "nodejs";

const MIN_TOPIC_LENGTH = 10;
const MAX_TOPIC_LENGTH = 300;

// Anonymous, unauthenticated, and running on shared free-tier providers —
// this can't be gated by credits like a real account, so it leans entirely
// on IP rate limiting plus a hard global concurrency cap (below) to keep
// the render queue's real capacity (WORKER_CONCURRENCY=1 as of Phase 3 --
// see worker/index.ts) available for actual paying/signed-up users.
const DEMO_LIMIT_PER_IP_PER_DAY = 3;
const MAX_CONCURRENT_DEMO_JOBS = 1;
// Arbitrary but must stay constant and distinct from lib/workers/admission.ts's
// ADMISSION_LOCK_KEY (unrelated critical section -- sharing a key would
// needlessly serialize demo-job admission against worker admission).
const DEMO_ADMISSION_LOCK_KEY = 419_662_003n;
// Company-wide ceiling across ALL anonymous visitors combined, independent of
// per-IP limits (a botnet or NAT-shared office IP could otherwise still add up
// to unbounded aggregate demo spend). Same in-memory rateLimit() mechanism as
// the per-IP check above -- deliberately not a second monitoring system.
// Read via a function (not a frozen top-level const) to match the same
// re-readable-env-var convention worker/index.ts's readWorkerConfigFromEnv()
// already established in this codebase, and so it stays testable per-call.
function getDemoGlobalLimitPerDay(): number {
  const raw = Number(process.env.DEMO_GLOBAL_LIMIT_PER_DAY ?? "200");
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 200;
}

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
  const { ok } = rateLimit(`demo-generate:${ip}`, DEMO_LIMIT_PER_IP_PER_DAY, 24 * 60 * 60 * 1000);
  if (!ok) {
    return NextResponse.json(
      { error: "You've used your free demos for today — sign up free for unlimited generations." },
      { status: 429 }
    );
  }

  const global = rateLimit("demo-generate:global", getDemoGlobalLimitPerDay(), 24 * 60 * 60 * 1000);
  if (!global.ok) {
    return NextResponse.json(
      { error: "Free demos have hit today's company-wide limit — sign up free for unlimited generations." },
      { status: 503 }
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
