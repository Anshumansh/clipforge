import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { publishToSocial } from "@/lib/social/publish";

// publishToYoutube (lib/social/publish.ts) fetches this URL server-side to
// stream it into YouTube's resumable upload — an arbitrary user-supplied URL
// there is a straightforward SSRF (internal network access, cloud metadata
// endpoints, etc.) via an otherwise-ordinary authenticated request. Require
// it to actually be one of Clipforge's own hosted media URLs; nothing about
// "publish my rendered video" needs it to be anything else.
function isOwnMediaUrl(url: string): boolean {
  const base = (process.env.NEXTAUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return url.startsWith(`${base}/api/media/media/`);
}

const schema = z.object({
  socialAccountId: z.string(),
  videoUrl: z.string().url().refine(isOwnMediaUrl, "videoUrl must be a Clipforge-hosted media URL"),
  caption: z.string().max(2200),
  projectId: z.string().optional(),
  clipId: z.string().optional(),
  scheduledAt: z.string().datetime().optional(),
});

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { ok } = rateLimit(`social-post:${userId}:${getClientIp(req)}`, 10, 60 * 1000);
  if (!ok) return NextResponse.json({ error: "Too many requests. Slow down and try again shortly." }, { status: 429 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const account = await db.socialAccount.findFirst({
    where: { id: parsed.data.socialAccountId, userId },
  });
  if (!account) return NextResponse.json({ error: "Connected account not found" }, { status: 404 });

  const scheduledAt = parsed.data.scheduledAt ? new Date(parsed.data.scheduledAt) : new Date();
  const isDueNow = scheduledAt.getTime() <= Date.now() + 1000;

  const post = await db.socialPost.create({
    data: {
      userId,
      socialAccountId: account.id,
      projectId: parsed.data.projectId,
      clipId: parsed.data.clipId,
      videoUrl: parsed.data.videoUrl,
      caption: parsed.data.caption,
      scheduledAt,
      status: isDueNow ? "posting" : "scheduled",
    },
  });

  if (!isDueNow) {
    return NextResponse.json({ postId: post.id, status: "scheduled" });
  }

  try {
    const result = await publishToSocial(account, parsed.data.videoUrl, parsed.data.caption);
    await db.socialPost.update({
      where: { id: post.id },
      data: { status: "posted", postedAt: new Date(), platformPostId: result.platformPostId },
    });
    return NextResponse.json({ postId: post.id, status: "posted", platformPostId: result.platformPostId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    await db.socialPost.update({ where: { id: post.id }, data: { status: "failed", errorMessage: message } });
    return NextResponse.json({ postId: post.id, status: "failed", error: message }, { status: 502 });
  }
}
