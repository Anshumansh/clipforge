import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isValidCronSecret } from "@/lib/cron-auth";

export const runtime = "nodejs";

// Reverts a user's plan back to whatever it was before an admin-granted
// trial (app/api/admin/comp-plan) once compPlanExpiresAt passes. Each
// user's most recent plan_comp AdminAction carries the correct previousPlan
// to revert to -- not a hardcoded "free" -- so a real paying subscriber who
// was comped a higher tier goes back to what they're actually paying for.
export async function POST(req: Request) {
  if (!isValidCronSecret(req.headers.get("x-cron-secret"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const expired = await db.user.findMany({
    where: { compPlanExpiresAt: { lte: new Date() } },
    select: { id: true },
  });

  let reverted = 0;
  for (const user of expired) {
    const lastComp = await db.adminAction.findFirst({
      where: { targetUserId: user.id, type: "plan_comp" },
      orderBy: { createdAt: "desc" },
    });
    const revertTo = lastComp?.previousPlan ?? "free";

    await db.user.update({
      where: { id: user.id },
      data: { plan: revertTo, compPlanExpiresAt: null },
    });
    reverted++;
  }

  return NextResponse.json({ ok: true, reverted });
}
