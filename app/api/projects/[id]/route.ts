import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const project = await db.project.findFirst({
    where: { id: params.id, userId },
    include: {
      clips: { orderBy: { score: "desc" } },
      jobs: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({
    id: project.id,
    type: project.type,
    title: project.title,
    status: project.status,
    videoUrl: project.videoUrl,
    thumbnailUrl: project.thumbnailUrl,
    hasTimeline: !!project.scenesJson,
    errorMessage: project.errorMessage,
    clips: project.clips,
    job: project.jobs[0]
      ? { status: project.jobs[0].status, progress: project.jobs[0].progress, log: project.jobs[0].log }
      : null,
  });
}
