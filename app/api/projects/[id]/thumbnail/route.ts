import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { fetchThumbnailBackground } from "@/lib/providers/broll";
import { renderThumbnail } from "@/lib/remotion-render";

export const runtime = "nodejs";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { ok } = rateLimit(`thumbnail:${userId}`, 10, 60 * 1000);
  if (!ok) return NextResponse.json({ error: "Too many requests. Slow down and try again shortly." }, { status: 429 });

  const project = await db.project.findFirst({ where: { id: params.id, userId } });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  if (project.status !== "ready") {
    return NextResponse.json({ error: "Project isn't finished rendering yet" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const keyword = typeof body.keyword === "string" && body.keyword.trim() ? body.keyword.trim().slice(0, 100) : project.title;

  const imageUrl = await fetchThumbnailBackground(keyword);
  const thumbnailUrl = await renderThumbnail(
    { imageUrl, title: project.title },
    `media/${userId}/${project.id}/thumbnail-${Date.now()}.jpg`
  );

  await db.project.update({ where: { id: project.id }, data: { thumbnailUrl } });

  return NextResponse.json({ thumbnailUrl });
}
