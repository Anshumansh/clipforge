import type { Metadata } from "next";
import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import { ScheduleCalendar } from "@/components/schedule-calendar";
import { canUseSocialPublishing } from "@/lib/plans";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Schedule" };

export default async function SchedulePage() {
  const user = await requireUser();

  if (!canUseSocialPublishing(user.plan)) {
    return (
      <div className="mx-auto max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle>Creator plan required</CardTitle>
            <CardDescription>Connect and schedule social posts without leaving Clipforge.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="mb-4 text-sm text-muted-foreground">
              Upgrade to Creator or Business to connect YouTube, TikTok or Instagram and schedule finished videos.
            </p>
            <Button asChild><a href="/pricing">View plans</a></Button>
          </CardContent>
        </Card>
      </div>
    );
  }

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
