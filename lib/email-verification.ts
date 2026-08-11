import { db } from "@/lib/db";

export class EmailNotVerifiedError extends Error {
  constructor() {
    super("Please verify your email before using this feature. Check your inbox, or resend the link from your account settings.");
    this.name = "EmailNotVerifiedError";
  }
}

/** Throws EmailNotVerifiedError for any account that hasn't confirmed its
 * email -- gates expensive generation, voice cloning, API keys, team
 * invitations and platform connections. Existing accounts from before this
 * feature shipped were backfilled with emailVerifiedAt set, so this only
 * actually blocks genuinely-new, unconfirmed signups. */
export async function requireVerifiedEmail(userId: string): Promise<void> {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { emailVerifiedAt: true } });
  if (!user.emailVerifiedAt) throw new EmailNotVerifiedError();
}
