import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getServerSession } from "next-auth";
import { z } from "zod";
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
import { rateLimit } from "@/lib/rate-limit";
import { ASPECT_RATIOS, canUseAspectRatio } from "@/lib/aspect-ratio";
import { resolveGenerationContext } from "@/lib/workspace";
import { requireVerifiedEmail, EmailNotVerifiedError } from "@/lib/email-verification";
import { getGenerationPriority } from "@/lib/jobs/priorities";
import { canUseUgc } from "@/lib/plans";

const schema = z.object({
  productName: z.string().min(1).max(120),
  sellingPoints: z.string().min(1).max(2000),
  ctaText: z.string().max(80).optional(),
  voice: z.string().optional(),
  aspectRatio: z.enum(ASPECT_RATIOS as [string, ...string[]]).optional(),
});

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

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  const genCtx = await resolveGenerationContext(userId, user.plan);

  if (!canUseUgc(genCtx.effectivePlan)) {
    return NextResponse.json(
      { error: "UGC ads are available on Creator and Business plans. Upgrade to get started." },
      { status: 403 }
    );
  }

  if (parsed.data.aspectRatio && !canUseAspectRatio(genCtx.effectivePlan, parsed.data.aspectRatio as never)) {
    return NextResponse.json({ error: "Multi-format export is a Business-plan feature" }, { status: 403 });
  }

  let genResult: GenerationReservationResult;
  try {
    genResult = await reserveGenerationCredits({
      type: "ugc",
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
    const project = await db.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: {
          userId,
          workspaceId: genCtx.workspaceId,
          type: "ugc",
          title: `${parsed.data.productName} — UGC ad`,
          status: "queued",
          input: JSON.stringify(parsed.data),
        },
      });
      const job = await tx.job.create({
        data: {
          userId,
          projectId: project.id,
          type: "render",
          status: "queued",
          priority: getGenerationPriority(genCtx.effectivePlan),
        },
      });
      await tx.creditReservation.update({ where: { id: reservationId }, data: { jobId: job.id } });
      return project;
    });

    // No local enqueue step -- the worker process picks up this queued
    // job on its own poll loop. See app/api/projects/script/route.ts for
    // the fuller comment; identical reasoning applies here.
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
      console.error("[ugc-route] failed to release reservation after project-creation error:", e)
    );
    throw err;
  }
}
