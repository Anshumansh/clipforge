import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { resolveAdminUserId } from "@/lib/admin-auth";

const schema = z.object({
  userId: z.string().min(1),
  amount: z.number().int().min(1).max(100000),
  note: z.string().min(1).max(300),
});

export async function POST(req: Request) {
  const adminId = await resolveAdminUserId();
  if (!adminId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  const { userId, amount, note } = parsed.data;

  const target = await db.user.findUnique({ where: { id: userId } });
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const [updated] = await db.$transaction([
    db.user.update({ where: { id: userId }, data: { credits: { increment: amount } } }),
    db.adminAction.create({
      data: { adminId, targetUserId: userId, type: "credit_grant", creditsGranted: amount, note },
    }),
  ]);

  return NextResponse.json({ ok: true, credits: updated.credits });
}
