import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { resolveAdminUserId } from "@/lib/admin-auth";
import { verifyTotpCode, generateBackupCodes, hashBackupCodes } from "@/lib/mfa";
import { encrypt } from "@/lib/crypto";

export const runtime = "nodejs";

const schema = z.object({ secret: z.string().min(16), code: z.string().min(6).max(6) });

export async function POST(req: Request) {
  const adminId = await resolveAdminUserId();
  if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  const { secret, code } = parsed.data;

  const user = await db.user.findUniqueOrThrow({ where: { id: adminId }, select: { email: true } });
  if (!verifyTotpCode(secret, code, user.email)) {
    return NextResponse.json({ error: "That code didn't match. Check your authenticator app and try again." }, { status: 400 });
  }

  const backupCodes = generateBackupCodes();
  const hashed = await hashBackupCodes(backupCodes);

  await db.user.update({
    where: { id: adminId },
    data: { totpSecret: encrypt(secret), totpEnabledAt: new Date(), totpBackupCodes: JSON.stringify(hashed) },
  });

  // Backup codes are shown exactly once -- only their bcrypt hashes are ever
  // stored, so this response is the only chance to see them in the clear.
  return NextResponse.json({ ok: true, backupCodes });
}
