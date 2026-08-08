import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getChannelsInfo, getRecentVideoIds, getVideosStats, searchByNiche } from "@/lib/providers/youtube";
import { recordSnapshot, computeBreakoutScore } from "@/lib/trend/scoring";
import { extractPattern } from "@/lib/providers/pattern-extraction";

export const runtime = "nodejs";

/** Scheduled ingestion — run every 2-6h via cron (see scripts/process-trend-ingestion.sh),
 * same pattern as the existing scheduled-social-post processor. Not a user-facing route. */
export async function POST(req: Request) {
  const secret = req.headers.get("x-cron-secret");
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const summary = { channelsChecked: 0, nichesSearched: 0, videosScored: 0, breakouts: 0, patternsExtracted: 0 };

  try {
    const trackedChannels = await db.trackedChannel.findMany({ distinct: ["youtubeChannelId"] });
    const channelIds = [...new Set(trackedChannels.map((c) => c.youtubeChannelId))];

    const niches = await db.userNiche.findMany({ select: { niche: true } });
    const distinctNiches = [...new Set(niches.map((n) => n.niche.trim().toLowerCase()).filter(Boolean))];

    const videoIds = new Set<string>();

    if (channelIds.length > 0) {
      const channels = await getChannelsInfo(channelIds);
      summary.channelsChecked = channels.length;
      for (const channel of channels) {
        const recent = await getRecentVideoIds(channel.uploadsPlaylistId, 10);
        recent.forEach((id) => videoIds.add(id));
      }
    }

    for (const niche of distinctNiches) {
      const found = await searchByNiche(niche, 15);
      found.forEach((id) => videoIds.add(id));
      summary.nichesSearched++;
    }

    if (videoIds.size === 0) {
      return NextResponse.json({ ok: true, summary, note: "No tracked channels or niches to ingest yet" });
    }

    const videos = await getVideosStats([...videoIds]);
    summary.videosScored = videos.length;

    for (const video of videos) {
      await recordSnapshot(video);
      const breakout = await computeBreakoutScore(video.id);
      if (!breakout?.isBreakout) continue;
      summary.breakouts++;

      // Cache aggressively — a video's pattern, once extracted, never needs
      // re-extracting; this is the only costed step (an LLM call) in the
      // whole pipeline.
      const alreadyExtracted = await db.extractedPattern.findUnique({ where: { videoId: video.id } });
      if (alreadyExtracted) continue;

      const pattern = await extractPattern(video);
      if (!pattern) continue; // no free LLM configured, or extraction failed — skip, don't fabricate

      await db.extractedPattern.create({ data: { videoId: video.id, ...pattern } });
      summary.patternsExtracted++;
    }

    return NextResponse.json({ ok: true, summary });
  } catch (err) {
    console.error("[trend-ingest] failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, summary, error: "Ingestion failed" }, { status: 500 });
  }
}
