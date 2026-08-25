import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveApiUser } from "@/lib/api-auth";
import { projectAccessFilter } from "@/lib/workspace";
import { deleteMediaByPrefix } from "@/lib/storage";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const apiUser = await resolveApiUser(req);
  if (!apiUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const project = await db.project.findFirst({
    where: { id, ...(await projectAccessFilter(apiUser.userId)) },
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

/** Deletes a single project (and its jobs/clips, via Prisma's onDelete:
 * Cascade). Restricted to the actual creator, not the broader
 * projectAccessFilter workspace-membership set used for GET -- a workspace
 * member being able to view a shared project doesn't mean they should be
 * able to delete someone else's generated video. CreditLedgerEntry/
 * JobCostRecord rows referencing this project are deliberately NOT
 * cascade-deleted (they're a plain string projectId, not a real FK) --
 * the financial audit trail must survive project deletion. */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const apiUser = await resolveApiUser(req);
  if (!apiUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const project = await db.project.findFirst({
    where: { id, userId: apiUser.userId },
    include: { jobs: { select: { id: true } } },
  });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Best-effort storage cleanup before the DB row goes away -- covers both
  // key conventions this app has used (see app/api/media/[...key]/route.ts's
  // ALLOWED_PREFIXES comment): the legacy "media/<userId>/<projectId>/..."
  // prefix, and the attempt-scoped "jobs/<jobId>/attempts/..." prefix every
  // render has used since the queue-lifecycle-fencing pass. A storage
  // failure here must not block the actual deletion the user asked for.
  await Promise.all([
    deleteMediaByPrefix(`media/${apiUser.userId}/${project.id}/`),
    ...project.jobs.map((job) => deleteMediaByPrefix(`jobs/${job.id}/`)),
  ]).catch((err) => {
    console.error("[project-delete] storage cleanup failed:", err instanceof Error ? err.message : err);
  });

  await db.project.delete({ where: { id: project.id } });

  return NextResponse.json({ ok: true });
}
