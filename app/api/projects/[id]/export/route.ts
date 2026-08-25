import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { generateEDL, generateFcp7Xml } from "@/lib/export/edl";
import { ASPECT_RATIO_DIMENSIONS, isAspectRatio } from "@/lib/aspect-ratio";
import { projectAccessFilter } from "@/lib/workspace";
import type { SceneTimelineEntry } from "@/lib/timeline";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const project = await db.project.findFirst({ where: { id, ...(await projectAccessFilter(userId)) } });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (!project.scenesJson) {
    return NextResponse.json(
      { error: "No timeline available for this project. Timeline export is available for script-to-video projects rendered after this feature shipped." },
      { status: 400 }
    );
  }

  const format = new URL(req.url).searchParams.get("format");
  if (format !== "edl" && format !== "xml") {
    return NextResponse.json({ error: "format must be 'edl' or 'xml'" }, { status: 400 });
  }

  const entries = JSON.parse(project.scenesJson) as SceneTimelineEntry[];
  const input = JSON.parse(project.input) as { aspectRatio?: unknown };
  const dims = ASPECT_RATIO_DIMENSIONS[isAspectRatio(input.aspectRatio) ? input.aspectRatio : "9:16"];
  const filenameBase = project.title.replace(/[^a-z0-9-_]+/gi, "-").slice(0, 60) || "clipforge-export";

  if (format === "edl") {
    const body = generateEDL(project.title, entries);
    return new NextResponse(body, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filenameBase}.edl"`,
      },
    });
  }

  const body = generateFcp7Xml(project.title, entries, 30, dims.width, dims.height);
  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filenameBase}.xml"`,
    },
  });
}
