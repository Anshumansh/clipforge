import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { resolveAdminUserId } from "@/lib/admin-auth";
import { verifyTotpCode, consumeBackupCode } from "@/lib/mfa";
import { decrypt } from "@/lib/crypto";

export const runtime = "nodejs";

const schema = z.object({ code: z.string().min(6) });

// Requires a current, valid TOTP or backup code to turn MFA off -- an admin
// session alone (e.g. a hijacked cookie) can't disable the protection it's
// supposed to be adding.
export async function POST(req: Request) {
  const adminId = await resolveAdminUserId();
  if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const user = await db.user.findUniqueOrThrow({
    where: { id: adminId },
    select: { email: true, totpSecret: true, totpBackupCodes: true },
  });
  if (!user.totpSecret) return NextResponse.json({ error: "MFA isn't enabled" }, { status: 400 });

  const code = parsed.data.code.trim();
  const validTotp = /^\d{6}$/.test(code) && verifyTotpCode(decrypt(user.totpSecret), code, user.email);
  const validBackup =
    !validTotp && user.totpBackupCodes
      ? (await consumeBackupCode(JSON.parse(user.totpBackupCodes), code)) !== null
      : false;

  if (!validTotp && !validBackup) {
    return NextResponse.json({ error: "That code didn't match." }, { status: 400 });
  }

  await db.user.update({
    where: { id: adminId },
    data: { totpSecret: null, totpEnabledAt: null, totpBackupCodes: null },
  });

  return NextResponse.json({ ok: true });
}
