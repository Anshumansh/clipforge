import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { getStripe } from "@/lib/stripe";
import { deleteUserMedia } from "@/lib/storage";
import { rateLimit } from "@/lib/rate-limit";

const schema = z.object({ password: z.string().min(1) });

/** Permanent, self-service account deletion — cancels any active
 * subscription immediately, deletes every stored media file, then deletes
 * the user row (which cascades projects/jobs/clips/social accounts/trend
 * data/etc. via Prisma's onDelete: Cascade). Requires re-entering the
 * current password as confirmation, separate from just having an open
 * session, given this is irreversible. */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { ok } = rateLimit(`account-delete:${userId}`, 5, 10 * 60 * 1000);
  if (!ok) return NextResponse.json({ error: "Too many attempts. Try again in a few minutes." }, { status: 429 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  const validPassword = await bcrypt.compare(parsed.data.password, user.passwordHash);
  if (!validPassword) return NextResponse.json({ error: "Incorrect password" }, { status: 403 });

  if (user.stripeSubscriptionId) {
    try {
      await getStripe().subscriptions.cancel(user.stripeSubscriptionId);
    } catch (err) {
      // Don't block account deletion on a Stripe hiccup (e.g. already
      // canceled) — log it, but the user's data still gets removed either way.
      console.error("[account-delete] Stripe cancellation failed:", err instanceof Error ? err.message : err);
    }
  }

  await deleteUserMedia(userId).catch((err) => {
    console.error("[account-delete] storage cleanup failed:", err instanceof Error ? err.message : err);
  });

  await db.user.delete({ where: { id: userId } });

  return NextResponse.json({ ok: true });
}
