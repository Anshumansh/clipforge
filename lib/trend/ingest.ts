import { db } from "@/lib/db";
import { getChannelsInfo, getRecentVideoIds, getVideosStats, searchByNiche } from "@/lib/providers/youtube";
import { recordSnapshot, computeBreakoutScore } from "@/lib/trend/scoring";
import { extractPattern } from "@/lib/providers/pattern-extraction";

export interface IngestSummary {
  channelsChecked: number;
  nichesSearched: number;
  videosScored: number;
  breakouts: number;
  patternsExtracted: number;
}

/** Fetches recent videos for the given channels (+ optional niche searches),
 * records snapshots, scores breakouts, and extracts patterns for anything that
 * clears the breakout threshold. Shared by the scheduled cron job
 * (app/api/trend/ingest/route.ts) and the on-demand first-scan that runs right
 * after a user finishes onboarding (app/api/trend/onboarding/route.ts) — same
 * logic either way, just a different trigger and a smaller channel set. */
export async function ingestChannels(channelIds: string[], niches: string[] = []): Promise<IngestSummary> {
  const summary: IngestSummary = { channelsChecked: 0, nichesSearched: 0, videosScored: 0, breakouts: 0, patternsExtracted: 0 };

  const videoIds = new Set<string>();

  if (channelIds.length > 0) {
    const channels = await getChannelsInfo(channelIds);
    summary.channelsChecked = channels.length;
    for (const channel of channels) {
      const recent = await getRecentVideoIds(channel.uploadsPlaylistId, 10);
      recent.forEach((id) => videoIds.add(id));
    }
  }

  const distinctNiches = [...new Set(niches.map((n) => n.trim().toLowerCase()).filter(Boolean))];
  for (const niche of distinctNiches) {
    const found = await searchByNiche(niche, 15);
    found.forEach((id) => videoIds.add(id));
    summary.nichesSearched++;
  }

  if (videoIds.size === 0) return summary;

  const videos = await getVideosStats([...videoIds]);
  summary.videosScored = videos.length;

  for (const video of videos) {
    await recordSnapshot(video);
    const breakout = await computeBreakoutScore(video.id);
    if (!breakout?.isBreakout) continue;
    summary.breakouts++;

    const alreadyExtracted = await db.extractedPattern.findUnique({ where: { videoId: video.id } });
    if (alreadyExtracted) continue;

    const pattern = await extractPattern(video);
    if (!pattern) continue; // no free LLM configured, or extraction failed — skip, don't fabricate

    await db.extractedPattern.create({ data: { videoId: video.id, ...pattern } });
    summary.patternsExtracted++;
  }

  return summary;
}

/** Every distinct tracked channel + niche across all users — what the
 * scheduled cron ingestion sweeps each cycle. */
export async function getAllTrackedChannelsAndNiches(): Promise<{ channelIds: string[]; niches: string[] }> {
  const trackedChannels = await db.trackedChannel.findMany({ distinct: ["youtubeChannelId"] });
  const channelIds = [...new Set(trackedChannels.map((c) => c.youtubeChannelId))];

  const userNiches = await db.userNiche.findMany({ select: { niche: true } });
  const niches = [...new Set(userNiches.map((n) => n.niche))];

  return { channelIds, niches };
}
