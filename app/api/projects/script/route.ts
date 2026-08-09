import path from "node:path";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { chargeCredits, CREDITS_PER_VIDEO, InsufficientCreditsError } from "@/lib/credits";
import { enqueueJob } from "@/lib/jobs/queue";
import { uploadBuffer } from "@/lib/storage";
import { rateLimit } from "@/lib/rate-limit";
import { ASPECT_RATIOS, isAspectRatio, canUseAspectRatio, type AspectRatio } from "@/lib/aspect-ratio";
import { canUseVoiceClone } from "@/lib/plans";
import { LANGUAGES } from "@/lib/languages";
import { resolveApiUser } from "@/lib/api-auth";
import { resolveGenerationContext } from "@/lib/workspace";

export const runtime = "nodejs";

const MAX_VOICE_SAMPLE_BYTES = 15 * 1024 * 1024; // 15MB reference clip

export async function POST(req: Request) {
  const apiUser = await resolveApiUser(req);
  if (!apiUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = apiUser.userId;

  const { ok } = rateLimit(`generate:${userId}`, 5, 60 * 1000);
  if (!ok) return NextResponse.json({ error: "Too many requests. Slow down and try again shortly." }, { status: 429 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Invalid form data" }, { status: 400 });

  const topic = String(form.get("topic") ?? "");
  const voice = form.get("voice") ? String(form.get("voice")) : undefined;
  const languageRaw = form.get("language") ? String(form.get("language")) : "en";
  const language = LANGUAGES.some((l) => l.code === languageRaw) ? languageRaw : "en";
  const aspectRatioRaw = form.get("aspectRatio");
  const aspectRatio: AspectRatio | undefined = isAspectRatio(aspectRatioRaw) ? aspectRatioRaw : undefined;
  const voiceSample = form.get("voiceSample");

  if (topic.length < 3 || topic.length > 4000) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  if (aspectRatioRaw && !ASPECT_RATIOS.includes(aspectRatioRaw as AspectRatio)) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const genCtx = await resolveGenerationContext(userId, apiUser.plan);

  if (aspectRatio && !canUseAspectRatio(genCtx.effectivePlan, aspectRatio)) {
    return NextResponse.json({ error: "Multi-format export is a Business-plan feature" }, { status: 403 });
  }

  let voiceSampleFile: File | null = null;
  if (voiceSample instanceof File && voiceSample.size > 0) {
    if (!canUseVoiceClone(genCtx.effectivePlan)) {
      return NextResponse.json({ error: "Voice cloning is a Business-plan feature" }, { status: 403 });
    }
    if (!voiceSample.type.startsWith("audio/")) {
      return NextResponse.json({ error: "Voice sample must be an audio file" }, { status: 400 });
    }
    if (voiceSample.size > MAX_VOICE_SAMPLE_BYTES) {
      return NextResponse.json({ error: "Voice sample too large (max 15MB)" }, { status: 400 });
    }
    // The UI requires an affirmative consent checkbox before this field can
    // even be submitted (Terms of Service §4.1) — enforced here too, since a
    // client-side checkbox alone doesn't stop a direct API call.
    if (form.get("voiceConsent") !== "true") {
      return NextResponse.json({ error: "Voice cloning consent is required" }, { status: 400 });
    }
    voiceSampleFile = voiceSample;
  }

  try {
    await chargeCredits(genCtx.creditOwnerId, CREDITS_PER_VIDEO);
  } catch (err) {
    if (err instanceof InsufficientCreditsError) {
      return NextResponse.json({ error: err.message }, { status: 402 });
    }
    throw err;
  }

  const project = await db.project.create({
    data: {
      userId,
      workspaceId: genCtx.workspaceId,
      type: "script",
      title: topic.slice(0, 60),
      status: "queued",
      input: "{}",
    },
  });

  let voiceSampleUrl: string | undefined;
  if (voiceSampleFile) {
    const ext = path.extname(voiceSampleFile.name || "") || ".mp3";
    const buffer = Buffer.from(await voiceSampleFile.arrayBuffer());
    voiceSampleUrl = await uploadBuffer(
      buffer,
      `media/${userId}/${project.id}/voice-sample${ext}`,
      voiceSampleFile.type || "audio/mpeg"
    );
  }

  await db.project.update({
    where: { id: project.id },
    data: {
      input: JSON.stringify({ topic, voice, language, aspectRatio, voiceSampleUrl, watermark: genCtx.effectivePlan === "free" }),
    },
  });

  const job = await db.job.create({
    data: { userId, projectId: project.id, type: "render", status: "queued" },
  });

  enqueueJob(job.id, "script");

  return NextResponse.json({ projectId: project.id });
}
