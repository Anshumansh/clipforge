import { Flame, Trophy } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { STREAK_MILESTONES } from "@/lib/streaks";

export function StreakCard({ currentStreak, longestStreak }: { currentStreak: number; longestStreak: number }) {
  if (currentStreak === 0) return null;

  const nextMilestone = STREAK_MILESTONES.find((m) => m > currentStreak);
  const prevMilestone = [...STREAK_MILESTONES].reverse().find((m) => m <= currentStreak) ?? 0;
  const progress = nextMilestone
    ? Math.round(((currentStreak - prevMilestone) / (nextMilestone - prevMilestone)) * 100)
    : 100;

  return (
    <div className="glow-ring mb-6 rounded-xl">
      <div className="flex flex-col gap-4 rounded-xl border border-transparent bg-card/80 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500/20 to-orange-500/20">
            <Flame className="h-5 w-5 text-amber-500" />
          </div>
          <div>
            <p className="font-display font-semibold">{currentStreak}-day streak</p>
            <p className="text-xs text-muted-foreground">
              {nextMilestone ? `${nextMilestone - currentStreak} more to your ${nextMilestone}-day badge` : "Longest streak on record — keep it going"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4 sm:w-64">
          <Progress value={progress} className="h-1.5" />
          {longestStreak > currentStreak && (
            <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
              <Trophy className="h-3.5 w-3.5" /> best {longestStreak}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
