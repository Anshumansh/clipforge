import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { sendVerificationEmail, isEmailConfigured } from "@/lib/email";

const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

function getAppBaseUrl(): string {
  return (process.env.NEXTAUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export async function POST() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { ok } = rateLimit(`resend-verification:${userId}`, 3, 10 * 60 * 1000);
  if (!ok) return NextResponse.json({ error: "Too many requests. Try again in a few minutes." }, { status: 429 });

  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, emailVerifiedAt: true } });
  if (user.emailVerifiedAt) return NextResponse.json({ message: "Already verified" });

  if (!isEmailConfigured()) {
    return NextResponse.json({ error: "Email sending isn't configured on this server yet" }, { status: 503 });
  }

  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  await db.emailVerificationToken.create({
    data: { userId, tokenHash, expiresAt: new Date(Date.now() + VERIFY_TOKEN_TTL_MS) },
  });

  try {
    await sendVerificationEmail(user.email, `${getAppBaseUrl()}/verify-email/${rawToken}`);
  } catch (err) {
    console.error("[resend-verification] failed to send:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Couldn't send the email right now — try again shortly" }, { status: 502 });
  }

  return NextResponse.json({ message: "Verification email sent" });
}
