import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { resolveAdminUserId } from "@/lib/admin-auth";
import { PLANS } from "@/lib/plans";

const PLAN_IDS = ["free", ...PLANS.map((p) => p.id)] as [string, ...string[]];

const schema = z.object({
  userId: z.string().min(1),
  plan: z.enum(PLAN_IDS),
  days: z.number().int().min(1).max(365),
  note: z.string().min(1).max(300),
});

export async function POST(req: Request) {
  const adminId = await resolveAdminUserId();
  if (!adminId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  const { userId, plan, days, note } = parsed.data;

  const target = await db.user.findUnique({ where: { id: userId } });
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });

  // If a comp is already active, target.plan IS the comp value -- snapshot
  // the ORIGINAL plan from the prior comp action instead, so extending or
  // changing an in-progress trial still reverts to what the user actually
  // had before any comping started, not to the comp itself.
  let previousPlan = target.plan;
  if (target.compPlanExpiresAt && target.compPlanExpiresAt > new Date()) {
    const lastComp = await db.adminAction.findFirst({
      where: { targetUserId: userId, type: "plan_comp" },
      orderBy: { createdAt: "desc" },
    });
    if (lastComp?.previousPlan) previousPlan = lastComp.previousPlan;
  }

  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

  const [updated] = await db.$transaction([
    db.user.update({ where: { id: userId }, data: { plan, compPlanExpiresAt: expiresAt } }),
    db.adminAction.create({
      data: {
        adminId,
        targetUserId: userId,
        type: "plan_comp",
        planGranted: plan,
        previousPlan,
        days,
        note,
      },
    }),
  ]);

  return NextResponse.json({ ok: true, plan: updated.plan, expiresAt: updated.compPlanExpiresAt });
}
