import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { getChannelsInfo } from "@/lib/providers/youtube";
import { BREAKOUT_THRESHOLD } from "@/lib/trend/scoring";
import { rateLimit } from "@/lib/rate-limit";

const MIN_BASELINE_SAMPLES = 3; // must match lib/trend/scoring.ts

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Unlike most GETs, this one makes a real YouTube API call (getChannelsInfo
  // below) on every load — worth capping so a refresh loop (buggy client or
  // otherwise) can't burn through the shared 10k/day quota the scheduled
  // ingestion job also depends on.
  const { ok } = rateLimit(`trend-feed:${userId}`, 20, 60 * 1000);
  if (!ok) return NextResponse.json({ error: "Too many requests. Slow down and try again shortly." }, { status: 429 });

  const userNiche = await db.userNiche.findUnique({
    where: { userId },
    include: { trackedChannels: true },
  });

  if (!userNiche) {
    return NextResponse.json({ needsOnboarding: true, cards: [] });
  }

  const trackedChannelIds = userNiche.trackedChannels.map((c) => c.youtubeChannelId);
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  // Tracked channels are an exact match; niche match is a pragmatic title
  // keyword search rather than a stored many-to-many link (a video isn't
  // tagged with which niche search found it) — a reasonable approximation,
  // not a precise one.
  const videos = await db.youtubeVideo.findMany({
    where: {
      publishedAt: { gte: since },
      OR: [
        ...(trackedChannelIds.length > 0 ? [{ channelId: { in: trackedChannelIds } }] : []),
        { title: { contains: userNiche.niche, mode: "insensitive" as const } },
      ],
    },
    include: {
      pattern: true,
      breakoutScores: { orderBy: { computedAt: "desc" as const }, take: 1 },
    },
    orderBy: { publishedAt: "desc" },
    take: 30,
  });

  if (videos.length === 0) {
    return NextResponse.json({ needsOnboarding: false, cards: [], niche: userNiche.niche, channelCount: trackedChannelIds.length });
  }

  // hasBaseline needs each channel's total historical sample count, not just
  // this one video's latest score — cheap enough to compute per distinct
  // channel in this result set rather than per video.
  const distinctChannelIds = [...new Set(videos.map((v) => v.channelId))];
  const baselineCounts = await Promise.all(
    distinctChannelIds.map(async (channelId) => ({
      channelId,
      count: await db.breakoutScore.count({ where: { video: { channelId } } }),
    }))
  );
  const baselineByChannel = new Map(baselineCounts.map((b) => [b.channelId, b.count]));

  const channelInfos = await getChannelsInfo(distinctChannelIds).catch(() => []);
  const channelTitleById = new Map(channelInfos.map((c) => [c.id, c.title]));
  for (const tc of userNiche.trackedChannels) {
    if (!channelTitleById.has(tc.youtubeChannelId) && tc.channelTitle) {
      channelTitleById.set(tc.youtubeChannelId, tc.channelTitle);
    }
  }

  const cards = videos
    .map((video) => {
      const latestScore = video.breakoutScores[0];
      const hasBaseline = (baselineByChannel.get(video.channelId) ?? 0) >= MIN_BASELINE_SAMPLES;
      const isBreakout = hasBaseline && (latestScore?.score ?? 0) >= BREAKOUT_THRESHOLD;

      return {
        videoId: video.id,
        title: video.title,
        thumbnailUrl: video.thumbnailUrl,
        channelId: video.channelId,
        channelTitle: channelTitleById.get(video.channelId) ?? "Unknown channel",
        publishedAt: video.publishedAt,
        velocity: latestScore?.velocity ?? null,
        score: latestScore?.score ?? null,
        hasBaseline,
        isBreakout,
        pattern: video.pattern
          ? {
              hookType: video.pattern.hookType,
              structure: video.pattern.structure,
              emotionalDriver: video.pattern.emotionalDriver,
            }
          : null,
      };
    })
    // Real breakouts with a pattern first, then breakouts without one yet,
    // then everything else by recency.
    .sort((a, b) => {
      const rank = (c: typeof a) => (c.isBreakout && c.pattern ? 2 : c.isBreakout ? 1 : 0);
      return rank(b) - rank(a) || (b.score ?? 0) - (a.score ?? 0);
    })
    .slice(0, 18);

  return NextResponse.json({ needsOnboarding: false, cards, niche: userNiche.niche, channelCount: trackedChannelIds.length });
}
