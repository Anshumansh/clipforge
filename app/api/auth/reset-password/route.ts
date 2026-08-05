import crypto from "node:crypto";
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { rateLimit, getClientIp } from "@/lib/rate-limit";

const schema = z.object({
  token: z.string().min(1),
  password: z.string().min(6).max(200),
});

export async function POST(req: Request) {
  const { ok } = rateLimit(`reset-password:${getClientIp(req)}`, 10, 10 * 60 * 1000);
  if (!ok) return NextResponse.json({ error: "Too many attempts. Try again in a few minutes." }, { status: 429 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const tokenHash = crypto.createHash("sha256").update(parsed.data.token).digest("hex");
  const record = await db.passwordResetToken.findUnique({ where: { tokenHash } });

  if (!record || record.usedAt || record.expiresAt < new Date()) {
    return NextResponse.json({ error: "This reset link is invalid or has expired" }, { status: 400 });
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 10);

  await db.$transaction([
    db.user.update({ where: { id: record.userId }, data: { passwordHash } }),
    db.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
  ]);

  return NextResponse.json({ message: "Password updated" });
}
