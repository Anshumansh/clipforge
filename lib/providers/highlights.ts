import { chatJSON } from "./llm";
import type { Transcript } from "./transcription";

export interface HighlightClip {
  startSec: number;
  endSec: number;
  title: string;
  /** 0-100 predicted hook/share strength — see the scoring rubric in the prompt below. */
  score: number;
}

const MIN_CLIP_LEN = 8;
const MAX_CLIP_LEN = 50;
const DEFAULT_SCORE = 50;

function clampClips(clips: HighlightClip[], durationSec: number): HighlightClip[] {
  const cleaned = clips
    .map((c) => ({
      startSec: Math.max(0, Math.min(c.startSec, durationSec - 1)),
      endSec: Math.max(0, Math.min(c.endSec, durationSec)),
      title: (c.title || "Highlight").slice(0, 80),
      score: Math.round(Math.max(0, Math.min(100, Number(c.score) || DEFAULT_SCORE))),
    }))
    .filter((c) => c.endSec - c.startSec >= MIN_CLIP_LEN)
    .map((c) => (c.endSec - c.startSec > MAX_CLIP_LEN ? { ...c, endSec: c.startSec + MAX_CLIP_LEN } : c))
    .sort((a, b) => a.startSec - b.startSec);

  // Drop clips that overlap a previously accepted one (chronological pass first, so
  // the earlier of two overlapping candidates wins regardless of score).
  const nonOverlapping: HighlightClip[] = [];
  for (const clip of cleaned) {
    const last = nonOverlapping[nonOverlapping.length - 1];
    if (!last || clip.startSec >= last.endSec) nonOverlapping.push(clip);
  }

  // Rank by score for the final list — matches how creators actually want to scan
  // results (best clip first), same pattern as competitors' virality scoring.
  return nonOverlapping.sort((a, b) => b.score - a.score).slice(0, 4);
}

function transcriptToPrompt(transcript: Transcript): string {
  // Cap length so we don't blow the context window / spend on very long sources.
  const lines = transcript.segments.map((s) => `[${s.start.toFixed(1)}-${s.end.toFixed(1)}] ${s.text}`);
  const joined = lines.join("\n");
  return joined.length > 12000 ? joined.slice(0, 12000) : joined;
}

export async function planHighlightsFromTranscript(
  transcript: Transcript,
  durationSec: number,
  topic: string
): Promise<HighlightClip[] | null> {
  if (transcript.segments.length === 0) return null;

  const maxClips = Math.min(4, Math.max(1, Math.floor(durationSec / 25)));

  const parsed = await chatJSON(
    [
      {
        role: "system",
        content:
          `You are a short-form video editor. You're given a timestamped transcript of a long-form video ` +
          `(topic: "${topic || "unknown"}"). Pick up to ${maxClips} of the single most compelling, self-contained ` +
          `moments that would work as standalone vertical clips (surprising claims, concrete stories, strong opinions, ` +
          `punchy advice — not filler or intros). Each clip must be ${MIN_CLIP_LEN}-${MAX_CLIP_LEN} seconds, use real ` +
          `timestamps from the transcript, and not overlap other clips.\n\n` +
          `For each clip also give a "score" from 0-100 predicting how well it'll perform as a standalone short, ` +
          `weighing: (1) how strong the first 2 seconds are as a hook, (2) whether it has a clear, satisfying ` +
          `payoff rather than trailing off, (3) how likely a viewer is to comment, share, or rewatch it, ` +
          `(4) whether it makes sense with zero context from the rest of the video. Spread scores realistically ` +
          `across the set — don't cluster everything near 80.\n\n` +
          `Return strict JSON: {"clips": [{"startSec": number, "endSec": number, "title": string (<=6 words, ` +
          `no clickbait), "score": number}]}.`,
      },
      { role: "user", content: transcriptToPrompt(transcript) },
    ],
    0.5
  );

  if (!parsed || !Array.isArray(parsed.clips) || parsed.clips.length === 0) return null;

  const clamped = clampClips(parsed.clips as HighlightClip[], durationSec);
  return clamped.length > 0 ? clamped : null;
}
