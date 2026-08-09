import type { Metadata } from "next";
import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import { ScheduleCalendar } from "@/components/schedule-calendar";

export const metadata: Metadata = { title: "Schedule" };

export default async function SchedulePage() {
  const user = await requireUser();

  // A generous window either side of "now" -- past posts for context (did
  // it actually go out, did it fail), future ones for the calendar itself.
  const posts = await db.socialPost.findMany({
    where: { userId: user.id },
    include: { socialAccount: { select: { platform: true, handle: true } } },
    orderBy: { scheduledAt: "asc" },
  });

  const items = posts.map((p) => ({
    id: p.id,
    platform: p.socialAccount.platform,
    handle: p.socialAccount.handle,
    caption: p.caption,
    status: p.status,
    scheduledAt: p.scheduledAt.toISOString(),
    errorMessage: p.errorMessage,
  }));

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Schedule</h1>
        <p className="text-sm text-muted-foreground">
          Every post you've scheduled or published, across all connected accounts. Schedule new ones from any
          finished project's Publish button.
        </p>
      </div>
      <ScheduleCalendar items={items} />
    </div>
  );
}
