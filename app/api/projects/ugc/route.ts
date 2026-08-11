import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { chargeCredits, CREDITS_PER_VIDEO, InsufficientCreditsError } from "@/lib/credits";
import { enqueueJob } from "@/lib/jobs/queue";
import { rateLimit } from "@/lib/rate-limit";
import { ASPECT_RATIOS, canUseAspectRatio } from "@/lib/aspect-ratio";
import { resolveGenerationContext } from "@/lib/workspace";
import { requireVerifiedEmail, EmailNotVerifiedError } from "@/lib/email-verification";

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

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  const genCtx = await resolveGenerationContext(userId, user.plan);
  if (parsed.data.aspectRatio && !canUseAspectRatio(genCtx.effectivePlan, parsed.data.aspectRatio as never)) {
    return NextResponse.json({ error: "Multi-format export is a Business-plan feature" }, { status: 403 });
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
      type: "ugc",
      title: `${parsed.data.productName} — UGC ad`,
      status: "queued",
      input: JSON.stringify(parsed.data),
    },
  });

  const job = await db.job.create({
    data: { userId, projectId: project.id, type: "render", status: "queued" },
  });

  enqueueJob(job.id, "ugc");

  return NextResponse.json({ projectId: project.id });
}
