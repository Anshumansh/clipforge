import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getDemoUserId } from "@/lib/demo-user";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const demoUserId = await getDemoUserId();

  // Scoped to the shared demo account specifically — this is a public,
  // unauthenticated endpoint, so it must never be usable to peek at a real
  // user's project by guessing an id.
  const project = await db.project.findFirst({
    where: { id, userId: demoUserId },
    select: {
      status: true,
      videoUrl: true,
      errorMessage: true,
      jobs: { select: { progress: true, log: true }, orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const job = project.jobs[0];

  return NextResponse.json({
    status: project.status,
    progress: job?.progress ?? 0,
    log: job?.log ?? null,
    videoUrl: project.videoUrl,
    errorMessage: project.errorMessage,
  });
}
