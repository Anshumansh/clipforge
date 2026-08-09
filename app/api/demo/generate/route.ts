import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { getDemoUserId } from "@/lib/demo-user";
import { enqueueJob } from "@/lib/jobs/queue";

export const runtime = "nodejs";

const MIN_TOPIC_LENGTH = 10;
const MAX_TOPIC_LENGTH = 300;

// Anonymous, unauthenticated, and running on shared free-tier providers —
// this can't be gated by credits like a real account, so it leans entirely
// on IP rate limiting plus a hard global concurrency cap (below) to keep
// the render queue's real capacity (2 concurrent renders total) available
// for actual paying/signed-up users.
const DEMO_LIMIT_PER_IP_PER_DAY = 3;
const MAX_CONCURRENT_DEMO_JOBS = 1;

export async function POST(req: Request) {
  const ip = getClientIp(req);
  const { ok } = rateLimit(`demo-generate:${ip}`, DEMO_LIMIT_PER_IP_PER_DAY, 24 * 60 * 60 * 1000);
  if (!ok) {
    return NextResponse.json(
      { error: "You've used your free demos for today — sign up free for unlimited generations." },
      { status: 429 }
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

  const activeDemoJobs = await db.job.count({
    where: { userId: demoUserId, status: { in: ["queued", "processing"] } },
  });
  if (activeDemoJobs >= MAX_CONCURRENT_DEMO_JOBS) {
    return NextResponse.json(
      { error: "High demand right now — give it a minute and try again." },
      { status: 429 }
    );
  }

  const project = await db.project.create({
    data: {
      userId: demoUserId,
      type: "script",
      title: topic.slice(0, 60),
      status: "queued",
      input: JSON.stringify({ topic, watermark: true, freeOnly: true }),
    },
  });

  const job = await db.job.create({
    data: { userId: demoUserId, projectId: project.id, type: "render", status: "queued" },
  });

  enqueueJob(job.id, "script");

  return NextResponse.json({ projectId: project.id });
}
