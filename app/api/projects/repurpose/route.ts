import path from "node:path";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { CREDITS_PER_VIDEO } from "@/lib/credits";
import { InsufficientCreditsError, releaseReservation } from "@/lib/pricing/ledger";
import {
  reserveGenerationCredits,
  getProjectIdForJob,
  isValidClientOperationId,
  type GenerationReservationResult,
} from "@/lib/pricing/generation-idempotency";
import { enqueueJob } from "@/lib/jobs/queue";
import { uploadBuffer } from "@/lib/storage";
import { rateLimit } from "@/lib/rate-limit";
import { isAspectRatio, canUseAspectRatio, type AspectRatio } from "@/lib/aspect-ratio";
import { resolveGenerationContext } from "@/lib/workspace";
import { requireVerifiedEmail, EmailNotVerifiedError } from "@/lib/email-verification";
import { canUseRepurpose } from "@/lib/plans";

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

  const file = form.get("file");
  const topic = String(form.get("topic") ?? "").slice(0, 200);
  const durationSec = Number(form.get("durationSec") ?? 0);
  const aspectRatioRaw = form.get("aspectRatio");
  const aspectRatio: AspectRatio | undefined = isAspectRatio(aspectRatioRaw) ? aspectRatioRaw : undefined;

  if (!(file instanceof File)) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  if (!file.type.startsWith("video/")) return NextResponse.json({ error: "File must be a video" }, { status: 400 });
  if (file.size > MAX_SIZE_BYTES) return NextResponse.json({ error: "File too large (max 300MB)" }, { status: 400 });
  if (!durationSec || durationSec < 10) {
    return NextResponse.json({ error: "Video must be at least 10 seconds" }, { status: 400 });
  }

  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  const genCtx = await resolveGenerationContext(userId, user.plan);

  if (!canUseRepurpose(genCtx.effectivePlan)) {
    return NextResponse.json(
      { error: "Repurpose is available on Hobby, Creator, and Business plans. Upgrade to get started." },
      { status: 403 }
    );
  }

  if (aspectRatio && !canUseAspectRatio(genCtx.effectivePlan, aspectRatio)) {
    return NextResponse.json({ error: "Multi-format export is a Business-plan feature" }, { status: 403 });
  }

  let genResult: GenerationReservationResult;
  try {
    genResult = await reserveGenerationCredits({
      type: "repurpose",
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

  if (genResult.status === "failed") {
    return NextResponse.json(
      { error: "This generation request already failed and cannot be retried. Please start a new generation.", code: "OPERATION_FAILED" },
      { status: 409 }
    );
  }

  const reservationId = genResult.reservationId;

  try {
    const { project, job } = await db.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: {
          userId,
          workspaceId: genCtx.workspaceId,
          type: "repurpose",
          title: topic || file.name || "Repurposed video",
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

    const ext = extensionFor(file);
    const buffer = Buffer.from(await file.arrayBuffer());
    const sourcePath = await uploadBuffer(buffer, `media/${userId}/${project.id}/source.${ext}`, file.type || "video/mp4");

    await db.project.update({
      where: { id: project.id },
      data: { input: JSON.stringify({ durationSec, sourcePath, topic, aspectRatio }) },
    });

    enqueueJob(job.id, "repurpose");
    return NextResponse.json({ projectId: project.id });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
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

    await releaseReservation(reservationId, "Project creation failed after credit reservation").catch((e) =>
      console.error("[repurpose-route] failed to release reservation after project-creation error:", e)
    );
    throw err;
  }
}
