import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveAdminUserId } from "@/lib/admin-auth";

export async function GET() {
  const adminId = await resolveAdminUserId();
  if (!adminId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const actions = await db.adminAction.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      admin: { select: { email: true } },
      targetUser: { select: { email: true } },
    },
  });

  return NextResponse.json({
    actions: actions.map((a) => ({
      id: a.id,
      adminEmail: a.admin.email,
      targetEmail: a.targetUser.email,
      type: a.type,
      creditsGranted: a.creditsGranted,
      planGranted: a.planGranted,
      previousPlan: a.previousPlan,
      days: a.days,
      note: a.note,
      createdAt: a.createdAt,
    })),
  });
}
