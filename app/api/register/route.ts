import crypto from "node:crypto";
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { sendVerificationEmail, isEmailConfigured } from "@/lib/email";

const schema = z.object({
  name: z.string().min(1).max(80),
  email: z.string().email(),
  password: z.string().min(6).max(200),
});

const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function getAppBaseUrl(): string {
  return (process.env.NEXTAUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export async function POST(req: Request) {
  const { ok } = rateLimit(`register:${getClientIp(req)}`, 10, 10 * 60 * 1000);
  if (!ok) {
    return NextResponse.json({ error: "Too many attempts. Try again in a few minutes." }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const { name, email, password } = parsed.data;
  const normalizedEmail = email.toLowerCase();

  const existing = await db.user.findUnique({ where: { email: normalizedEmail } });
  if (existing) {
    return NextResponse.json({ error: "An account with that email already exists" }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await db.user.create({
    data: { name, email: normalizedEmail, passwordHash },
  });

  // Best-effort -- a failed send shouldn't block account creation (matches
  // the forgot-password route's pattern). The user can always resend from
  // their dashboard once logged in.
  if (isEmailConfigured()) {
    try {
      const rawToken = crypto.randomBytes(32).toString("hex");
      const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
      await db.emailVerificationToken.create({
        data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now() + VERIFY_TOKEN_TTL_MS) },
      });
      await sendVerificationEmail(normalizedEmail, `${getAppBaseUrl()}/verify-email/${rawToken}`);
    } catch (err) {
      console.error("[register] failed to send verification email:", err instanceof Error ? err.message : err);
    }
  }

  return NextResponse.json({ id: user.id, email: user.email });
}
