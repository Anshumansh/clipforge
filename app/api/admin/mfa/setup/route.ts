import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { db } from "@/lib/db";
import { resolveAdminUserId } from "@/lib/admin-auth";
import { generateTotpSecret, buildTotp } from "@/lib/mfa";

export const runtime = "nodejs";

// Generates a fresh secret and returns it directly to the client (standard
// TOTP enrollment UX -- nothing is persisted here). The admin scans the QR
// or enters the key, then confirms one live code via POST /api/admin/mfa/enable,
// which is what actually writes the (encrypted) secret to the database.
export async function POST() {
  const adminId = await resolveAdminUserId();
  if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const user = await db.user.findUniqueOrThrow({ where: { id: adminId }, select: { email: true } });
  const secret = generateTotpSecret();
  const totp = buildTotp(secret.base32, user.email);
  const qrDataUrl = await QRCode.toDataURL(totp.toString());

  return NextResponse.json({ secret: secret.base32, qrDataUrl });
}
