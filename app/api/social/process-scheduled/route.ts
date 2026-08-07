import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { publishToSocial } from "@/lib/social/publish";

// Triggered by cron (see scripts/process-scheduled-posts.sh), not by a user —
// authenticated with a shared secret instead of a session, the same pattern
// Stripe webhooks use (signature/secret, not user auth).
export async function POST(req: Request) {
  const secret = req.headers.get("x-cron-secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const due = await db.socialPost.findMany({
    where: { status: "scheduled", scheduledAt: { lte: new Date() } },
    include: { socialAccount: true },
    take: 20,
  });

  const results = [];
  for (const post of due) {
    await db.socialPost.update({ where: { id: post.id }, data: { status: "posting" } });
    try {
      const result = await publishToSocial(post.socialAccount, post.videoUrl, post.caption);
      await db.socialPost.update({
        where: { id: post.id },
        data: { status: "posted", postedAt: new Date(), platformPostId: result.platformPostId },
      });
      results.push({ id: post.id, status: "posted" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      await db.socialPost.update({ where: { id: post.id }, data: { status: "failed", errorMessage: message } });
      results.push({ id: post.id, status: "failed", error: message });
    }
  }

  return NextResponse.json({ processed: results.length, results });
}
