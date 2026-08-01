import path from "node:path";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { chargeCredits, CREDITS_PER_VIDEO, InsufficientCreditsError } from "@/lib/credits";
import { enqueueJob } from "@/lib/jobs/queue";
import { uploadBuffer } from "@/lib/storage";

export const runtime = "nodejs";

const MAX_SIZE_BYTES = 300 * 1024 * 1024; // 300MB

function extensionFor(file: File) {
  const fromName = path.extname(file.name || "").replace(".", "");
  if (fromName) return fromName;
  if (file.type === "video/quicktime") return "mov";
  return "mp4";
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Invalid form data" }, { status: 400 });

  const file = form.get("file");
  const topic = String(form.get("topic") ?? "").slice(0, 200);
  const durationSec = Number(form.get("durationSec") ?? 0);

  if (!(file instanceof File)) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  if (!file.type.startsWith("video/")) return NextResponse.json({ error: "File must be a video" }, { status: 400 });
  if (file.size > MAX_SIZE_BYTES) return NextResponse.json({ error: "File too large (max 300MB)" }, { status: 400 });
  if (!durationSec || durationSec < 10) {
    return NextResponse.json({ error: "Video must be at least 10 seconds" }, { status: 400 });
  }

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
      type: "repurpose",
      title: topic || file.name || "Repurposed video",
      status: "queued",
      input: "{}",
    },
  });

  const ext = extensionFor(file);
  const buffer = Buffer.from(await file.arrayBuffer());
  const sourcePath = await uploadBuffer(buffer, `media/${userId}/${project.id}/source.${ext}`, file.type || "video/mp4");

  await db.project.update({
    where: { id: project.id },
    data: { input: JSON.stringify({ durationSec, sourcePath, topic }) },
  });

  const job = await db.job.create({
    data: { userId, projectId: project.id, type: "render", status: "queued" },
  });

  enqueueJob(job.id, "repurpose");

  return NextResponse.json({ projectId: project.id });
}
