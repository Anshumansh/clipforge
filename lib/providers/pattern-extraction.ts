import { chatJSONFree } from "./llm";
import type { VideoStats } from "./youtube";

export interface ExtractedPatternResult {
  hookType: string;
  structure: string;
  pacingNotes: string;
  titleFormula: string;
  thumbnailFormula: string;
  emotionalDriver: string;
}

/** Analyzes why a video is breaking out and returns a structured pattern —
 * never the source content itself. Only ever called on videos that already
 * cleared the breakout threshold (cost control), and only ever fed title +
 * description + thumbnail URL — never a transcript, which this app doesn't
 * fetch or store for third-party videos at all (see README note in
 * lib/providers/youtube.ts / the ingestion route for why).
 *
 * Deliberately Groq-only (chatJSONFree, not chatJSON): this runs unattended,
 * potentially many times per ingestion cycle, and must never silently spend
 * through a paid OpenAI key just because one happens to be configured for
 * user-triggered features elsewhere in the app. Returns null — the caller
 * should just skip storing a pattern for this video — if no free provider
 * is configured or the call fails; there's no mock fallback here, since
 * fabricating a fake "why it's breaking out" would be actively misleading. */
export async function extractPattern(video: VideoStats): Promise<ExtractedPatternResult | null> {
  const parsed = await chatJSONFree(
    [
      {
        role: "system",
        content:
          "You analyze why a short-form video is outperforming its channel's own normal pace. You are given only " +
          "its title, description, and thumbnail URL — never its spoken content. Identify the STRUCTURAL pattern " +
          "behind its success, not its subject matter. Return strict JSON with keys: hookType (short label, e.g. " +
          "'curiosity gap', 'bold claim', 'direct callout'), structure (1 sentence on how it's paced/organized), " +
          "pacingNotes (1 sentence), titleFormula (the reusable title pattern, e.g. 'I tried X for Y days'), " +
          "thumbnailFormula (1 sentence describing the visual pattern), emotionalDriver (1-2 words, e.g. " +
          "'surprise', 'FOMO', 'validation'). This is for pattern analysis only — do not reproduce or quote the " +
          "title verbatim in your output fields.",
      },
      {
        role: "user",
        content: `Title: ${video.title}\n\nDescription: ${video.description.slice(0, 500)}\n\nThumbnail: ${video.thumbnailUrl ?? "none"}`,
      },
    ],
    0.5
  );

  if (!parsed) return null;

  const required = ["hookType", "structure", "pacingNotes", "titleFormula", "thumbnailFormula", "emotionalDriver"] as const;
  if (!required.every((key) => typeof parsed[key] === "string")) return null;

  return {
    hookType: parsed.hookType as string,
    structure: parsed.structure as string,
    pacingNotes: parsed.pacingNotes as string,
    titleFormula: parsed.titleFormula as string,
    thumbnailFormula: parsed.thumbnailFormula as string,
    emotionalDriver: parsed.emotionalDriver as string,
  };
}

function wordNGrams(text: string, n: number): Set<string> {
  const words = text.toLowerCase().replace(/[^\w\s]/g, "").split(/\s+/).filter(Boolean);
  const grams = new Set<string>();
  for (let i = 0; i <= words.length - n; i++) grams.add(words.slice(i, i + n).join(" "));
  return grams;
}

/** Guardrail: flags a generated script that's too textually close to the
 * original source material it was inspired by (title + description — the
 * only source text this app ever touches). Word-5-gram overlap, no external
 * dependency needed for something this scoped. Call before finalizing any
 * script generated from a trend pattern; if flagged, regenerate or block. */
export function checkTextOverlap(
  generatedText: string,
  sourceTexts: string[]
): { overlapRatio: number; flagged: boolean } {
  const generatedGrams = wordNGrams(generatedText, 5);
  if (generatedGrams.size === 0) return { overlapRatio: 0, flagged: false };

  const sourceGrams = new Set(sourceTexts.flatMap((t) => [...wordNGrams(t, 5)]));

  let shared = 0;
  for (const gram of generatedGrams) {
    if (sourceGrams.has(gram)) shared++;
  }

  const overlapRatio = shared / generatedGrams.size;
  return { overlapRatio, flagged: overlapRatio > 0.15 };
}
