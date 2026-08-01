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
