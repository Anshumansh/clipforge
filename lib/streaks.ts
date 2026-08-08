import { db } from "@/lib/db";

export const STREAK_MILESTONES = [3, 7, 14, 30, 100] as const;

function toUtcDateOnly(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/** Call once per project that finishes rendering successfully. Increments the
 * user's daily streak if this is their first completed render of a new UTC day
 * (consecutive to the last one), resets it if a day was missed, and no-ops if
 * they've already recorded activity today. */
export async function recordActivity(userId: string): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { currentStreak: true, longestStreak: true, lastActiveAt: true },
  });
  if (!user) return;

  const today = toUtcDateOnly(new Date());
  const lastDay = user.lastActiveAt ? toUtcDateOnly(user.lastActiveAt) : null;
  const oneDayMs = 24 * 60 * 60 * 1000;

  if (lastDay === today) return; // already recorded today

  const nextStreak = lastDay === today - oneDayMs ? user.currentStreak + 1 : 1;

  await db.user.update({
    where: { id: userId },
    data: {
      currentStreak: nextStreak,
      longestStreak: Math.max(nextStreak, user.longestStreak),
      lastActiveAt: new Date(),
    },
  });
}
