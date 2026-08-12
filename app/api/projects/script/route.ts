import path from "node:path";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { CREDITS_PER_VIDEO } from "@/lib/credits";
import { InsufficientCreditsError, releaseReservation } from "@/lib/pricing/ledger";
import {
  reserveGenerationCredits,
  getProjectIdForJob,
  isValidClientOperationId,
  type GenerationReservationResult,
} from "@/lib/pricing/generation-idempotency";
import { uploadBuffer } from "@/lib/storage";
import { rateLimit } from "@/lib/rate-limit";
import { ASPECT_RATIOS, isAspectRatio, canUseAspectRatio, type AspectRatio } from "@/lib/aspect-ratio";
import { canUseVoiceClone } from "@/lib/plans";
import { LANGUAGES } from "@/lib/languages";
import { resolveApiUser } from "@/lib/api-auth";
import { resolveGenerationContext } from "@/lib/workspace";
import { requireVerifiedEmail, EmailNotVerifiedError } from "@/lib/email-verification";

export const runtime = "nodejs";

const MAX_VOICE_SAMPLE_BYTES = 15 * 1024 * 1024; // 15MB reference clip

export async function POST(req: Request) {
  const apiUser = await resolveApiUser(req);
  if (!apiUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = apiUser.userId;

  try {
    await requireVerifiedEmail(userId);
  } catch (err) {
    if (err instanceof EmailNotVerifiedError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }

  const { ok } = rateLimit(`generate:${userId}`, 5, 60 * 1000);
  if (!ok) return NextResponse.json({ error: "Too many requests. Slow down and try again shortly." }, { status: 429 });

  const clientOperationId = req.headers.get("Idempotency-Key");
  if (!isValidClientOperationId(clientOperationId)) {
    return NextResponse.json({ error: "Idempotency-Key header is required" }, { status: 400 });
  }

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

  // Reserve credits keyed to THIS operation id (see
  // lib/pricing/generation-idempotency.ts) -- a double-click, a browser/
  // network retry, or a concurrent duplicate POST all reuse the same
  // client-minted operation id and so collapse onto the same reservation
  // instead of charging twice. A new intentional Generate click always
  // carries a fresh operation id and is charged normally, even with
  // identical content.
  let genResult: GenerationReservationResult;
  try {
    genResult = await reserveGenerationCredits({
      type: "script",
      requestingUserId: userId,
      creditOwnerId: genCtx.creditOwnerId,
      workspaceId: genCtx.workspaceId ?? null,
      amount: CREDITS_PER_VIDEO,
      clientOperationId,
    });
  } catch (err) {
    if (err instanceof InsufficientCreditsError) {
      return NextResponse.json({ error: err.message }, { status: 402 });
    }
    throw err;
  }

  // A duplicate of an in-flight or already-completed identical request --
  // return the existing project rather than creating (and charging for) a
  // second one. This is what makes a lost HTTP response after the original
  // reservation succeeded safely retryable.
  if (genResult.status === "in-flight" || genResult.status === "already-completed") {
    const existingProjectId = genResult.jobId ? await getProjectIdForJob(genResult.jobId) : null;
    if (existingProjectId) {
      return NextResponse.json({ projectId: existingProjectId, duplicate: true });
    }
    return NextResponse.json(
      { error: "A duplicate request is already being processed. Please check your dashboard.", code: "OPERATION_PENDING" },
      { status: 409 }
    );
  }

  // This exact operation already failed (its reservation was released). A
  // client only ever reuses an operation id while retrying a still-pending
  // or just-succeeded action, never after observing a terminal failure --
  // so this means a stale/replayed retry arrived after the fact. Refuse it
  // rather than silently starting a new charge under an id the client
  // considers dead; the caller must start a new generation (new operation
  // id) to try again.
  if (genResult.status === "failed") {
    return NextResponse.json(
      { error: "This generation request already failed and cannot be retried. Please start a new generation.", code: "OPERATION_FAILED" },
      { status: 409 }
    );
  }

  // "new" or "recoverable" (a crashed prior attempt that never finished
  // creating its project/job) both proceed identically from here, reusing
  // the same reservationId rather than reserving again.
  const reservationId = genResult.reservationId;

  try {
    // project + job creation + attaching the reservation to the job all
    // happen in one transaction, so a crash anywhere in this block leaves
    // the reservation exactly as "reserved, no job" -- safely recoverable
    // by a retry with the same content, never a duplicate project or job.
    const { project, job } = await db.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: {
          userId,
          workspaceId: genCtx.workspaceId,
          type: "script",
          title: topic.slice(0, 60),
          status: "queued",
          input: "{}",
        },
      });
      const job = await tx.job.create({
        data: { userId, projectId: project.id, type: "render", status: "queued" },
      });
      await tx.creditReservation.update({ where: { id: reservationId }, data: { jobId: job.id } });
      return { project, job };
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

    // No local enqueue step -- the Job row was just created with
    // status="queued" inside the transaction above, and the worker
    // process (worker/index.ts) picks it up on its own poll loop via
    // lib/jobs/claim.ts. This web process never executes runners.
    return NextResponse.json({ projectId: project.id });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      // Lost a race to attach this reservation to a job -- a concurrent
      // identical request already won it. That request owns the outcome now;
      // return its project instead of releasing a reservation we don't own.
      const winner = await db.creditReservation.findUnique({ where: { id: reservationId } });
      const winnerProjectId = winner?.jobId ? await getProjectIdForJob(winner.jobId) : null;
      if (winnerProjectId) {
        return NextResponse.json({ projectId: winnerProjectId, duplicate: true });
      }
      return NextResponse.json(
        { error: "A duplicate request is already being processed. Please check your dashboard." },
        { status: 409 }
      );
    }

    // Project/job creation failed AFTER credits were reserved — release the
    // hold immediately so the user isn't left with a phantom charge.
    await releaseReservation(reservationId, "Project creation failed after credit reservation").catch((e) =>
      console.error("[script-route] failed to release reservation after project-creation error:", e)
    );
    throw err;
  }
}
