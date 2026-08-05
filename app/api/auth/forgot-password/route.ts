import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { sendPasswordResetEmail, isEmailConfigured } from "@/lib/email";

const schema = z.object({ email: z.string().email() });

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

function getAppBaseUrl(): string {
  return (process.env.NEXTAUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

// Always returns the same generic message whether or not the email exists,
// and whether or not sending actually succeeds — the response must not leak
// which emails have accounts.
function genericResponse() {
  return NextResponse.json({
    message: "If an account exists for that email, we've sent a password reset link.",
  });
}

export async function POST(req: Request) {
  const { ok } = rateLimit(`forgot-password:${getClientIp(req)}`, 5, 10 * 60 * 1000);
  if (!ok) return NextResponse.json({ error: "Too many attempts. Try again in a few minutes." }, { status: 429 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return genericResponse();

  if (!isEmailConfigured()) {
    console.error("[forgot-password] RESEND_API_KEY not set — cannot send reset emails");
    return genericResponse();
  }

  const email = parsed.data.email.toLowerCase();
  const user = await db.user.findUnique({ where: { email } });
  if (!user) return genericResponse();

  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

  await db.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
    },
  });

  const resetUrl = `${getAppBaseUrl()}/reset-password/${rawToken}`;

  try {
    await sendPasswordResetEmail(email, resetUrl);
  } catch (err) {
    console.error("[forgot-password] failed to send email:", err instanceof Error ? err.message : err);
  }

  return genericResponse();
}
