import { db } from "@/lib/db";
import type { VideoStats } from "@/lib/providers/youtube";

// A video scoring this many times its own channel's historical median velocity
// counts as "breaking out." Tune freely — this is the single knob that controls
// how aggressively pattern-extraction (the costed step) fires.
export const BREAKOUT_THRESHOLD = 3;

// Need at least this many prior velocity observations for a channel before its
// median is a trustworthy baseline — otherwise every new channel's first video
// looks like an infinite-multiple "breakout" against a baseline of nothing.
const MIN_BASELINE_SAMPLES = 3;

const HOUR_MS = 60 * 60 * 1000;

export interface BreakoutResult {
  velocity: number;
  channelMedianVelocity: number;
  score: number;
  hasBaseline: boolean;
  isBreakout: boolean;
}

/** Upserts the video's metadata and records one time-series snapshot. Call this
 * every ingestion cycle for every video being tracked, breakout or not — the
 * snapshot history is what velocity is computed from. */
export async function recordSnapshot(video: VideoStats): Promise<void> {
  await db.youtubeVideo.upsert({
    where: { id: video.id },
    create: {
      id: video.id,
      channelId: video.channelId,
      title: video.title,
      thumbnailUrl: video.thumbnailUrl,
      publishedAt: new Date(video.publishedAt),
    },
    update: {
      title: video.title,
      thumbnailUrl: video.thumbnailUrl,
    },
  });

  await db.trendSnapshot.create({
    data: {
      videoId: video.id,
      channelId: video.channelId,
      views: video.views,
      likes: video.likes,
      comments: video.comments,
    },
  });
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Views/hour between the two most recent snapshots, or — for a video seen for
 * the first time this cycle — views/hour since publish as a bootstrap estimate.
 * Waiting for a second snapshot before scoring at all would mean missing the
 * early-breakout window a 2-6h scan cadence exists to catch. */
async function computeVelocity(videoId: string, publishedAt: Date): Promise<number> {
  const snapshots = await db.trendSnapshot.findMany({
    where: { videoId },
    orderBy: { capturedAt: "desc" },
    take: 2,
  });

  if (snapshots.length >= 2) {
    const [latest, prev] = snapshots;
    const hours = (latest.capturedAt.getTime() - prev.capturedAt.getTime()) / HOUR_MS;
    if (hours <= 0) return 0;
    return Math.max(0, latest.views - prev.views) / hours;
  }

  if (snapshots.length === 1) {
    const hours = (snapshots[0].capturedAt.getTime() - publishedAt.getTime()) / HOUR_MS;
    if (hours <= 0) return 0;
    return snapshots[0].views / hours;
  }

  return 0;
}

/** Computes and stores this video's breakout score, comparing its current
 * velocity against its own channel's historical median (not a global bar —
 * a 10k-subscriber channel and a 10M-subscriber channel have very different
 * normal paces, and only the channel's own history is a fair comparison). */
export async function computeBreakoutScore(videoId: string): Promise<BreakoutResult | null> {
  const video = await db.youtubeVideo.findUnique({ where: { id: videoId } });
  if (!video) return null;

  const velocity = await computeVelocity(videoId, video.publishedAt);

  const history = await db.breakoutScore.findMany({
    where: { video: { channelId: video.channelId } },
    orderBy: { computedAt: "desc" },
    take: 30,
    select: { velocity: true },
  });
  const channelMedianVelocity = median(history.map((h) => h.velocity));
  const hasBaseline = history.length >= MIN_BASELINE_SAMPLES;

  const score = channelMedianVelocity > 0 ? velocity / channelMedianVelocity : velocity > 0 ? BREAKOUT_THRESHOLD : 0;

  await db.breakoutScore.create({
    data: { videoId, velocity, channelMedianVelocity, score },
  });

  return { velocity, channelMedianVelocity, score, hasBaseline, isBreakout: hasBaseline && score >= BREAKOUT_THRESHOLD };
}
