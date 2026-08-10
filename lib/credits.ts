import { db } from "@/lib/db";

export const CREDITS_PER_VIDEO = 10;

export class InsufficientCreditsError extends Error {
  constructor() {
    super("Not enough credits to start this render");
    this.name = "InsufficientCreditsError";
  }
}

export async function chargeCredits(userId: string, amount: number) {
  const result = await db.user.updateMany({
    where: { id: userId, credits: { gte: amount } },
    data: { credits: { decrement: amount } },
  });

  if (result.count === 0) {
    throw new InsufficientCreditsError();
  }
}

/** Reverses a chargeCredits() call -- must be called from every job runner's
 * failure path. Credits are charged up front (before queueing) so a job never
 * starts unpaid, which means a terminal failure has to give that charge back
 * explicitly; nothing does this automatically. */
export async function refundCredits(userId: string, amount: number) {
  await db.user.update({ where: { id: userId }, data: { credits: { increment: amount } } });
}
