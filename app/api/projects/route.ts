import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveApiUser } from "@/lib/api-auth";
import { getWorkspaceContext } from "@/lib/workspace";

export async function GET(req: Request) {
  const apiUser = await resolveApiUser(req);
  if (!apiUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limitRaw = Number(new URL(req.url).searchParams.get("limit"));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 50) : 20;

  const workspaceCtx = await getWorkspaceContext(apiUser.userId);
  const projects = await db.project.findMany({
    where: workspaceCtx
      ? { OR: [{ userId: apiUser.userId }, { workspaceId: workspaceCtx.workspaceId }] }
      : { userId: apiUser.userId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { id: true, type: true, title: true, status: true, videoUrl: true, createdAt: true },
  });

  return NextResponse.json({ projects });
}
