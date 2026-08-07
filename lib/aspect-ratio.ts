export type AspectRatio = "9:16" | "1:1" | "16:9";

export const ASPECT_RATIOS: AspectRatio[] = ["9:16", "1:1", "16:9"];

export const ASPECT_RATIO_LABELS: Record<AspectRatio, string> = {
  "9:16": "9:16 — TikTok / Reels / Shorts",
  "1:1": "1:1 — Instagram feed",
  "16:9": "16:9 — YouTube",
};

export const ASPECT_RATIO_DIMENSIONS: Record<AspectRatio, { width: number; height: number }> = {
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
  "16:9": { width: 1920, height: 1080 },
};

export function isAspectRatio(value: unknown): value is AspectRatio {
  return value === "9:16" || value === "1:1" || value === "16:9";
}

/** Multi-format export is a Business-plan feature (see the pricing page) —
 * every other plan is restricted to the default vertical format. */
export function canUseAspectRatio(plan: string, aspectRatio: AspectRatio): boolean {
  return aspectRatio === "9:16" || plan === "business";
}
