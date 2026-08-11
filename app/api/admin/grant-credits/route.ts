import crypto from "node:crypto";
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

  // Wrap the credit increment, admin action log, and ledger entry in one
  // transaction so all three succeed or none do. balanceAfter is read from
  // the result of the update (the exact post-increment value) rather than
  // target.credits + amount, which could be wrong under concurrent writes.
  const updated = await db.$transaction(async (tx) => {
    const result = await tx.user.update({
      where: { id: userId },
      data: { credits: { increment: amount } },
    });
    await tx.adminAction.create({
      data: { adminId, targetUserId: userId, type: "credit_grant", creditsGranted: amount, note },
    });
    await tx.creditLedgerEntry.create({
      data: {
        userId,
        type: "admin_adjustment",
        delta: amount,
        balanceAfter: result.credits,
        idempotencyKey: `admin-grant:${crypto.randomUUID()}`,
        note,
      },
    });
    return result;
  });

  return NextResponse.json({ ok: true, credits: updated.credits });
}
