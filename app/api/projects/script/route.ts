import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { chargeCredits, CREDITS_PER_VIDEO, InsufficientCreditsError } from "@/lib/credits";
import { enqueueJob } from "@/lib/jobs/queue";
import { rateLimit } from "@/lib/rate-limit";

const schema = z.object({
  topic: z.string().min(3).max(4000),
  voice: z.string().optional(),
});

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { ok } = rateLimit(`generate:${userId}`, 5, 60 * 1000);
  if (!ok) return NextResponse.json({ error: "Too many requests. Slow down and try again shortly." }, { status: 429 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  try {
    await chargeCredits(userId, CREDITS_PER_VIDEO);
  } catch (err) {
    if (err instanceof InsufficientCreditsError) {
      return NextResponse.json({ error: err.message }, { status: 402 });
    }
    throw err;
  }

  const project = await db.project.create({
    data: {
      userId,
      type: "script",
      title: parsed.data.topic.slice(0, 60),
      status: "queued",
      input: JSON.stringify(parsed.data),
    },
  });

  const job = await db.job.create({
    data: { userId, projectId: project.id, type: "render", status: "queued" },
  });

  enqueueJob(job.id, "script");

  return NextResponse.json({ projectId: project.id });
}
