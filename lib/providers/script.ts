import { chatJSON, chatJSONFree, chatJSONWithMeta } from "./llm";
import type { ScriptResult } from "./types";

/** Models asked for "plain spoken text, no stage directions" sometimes ignore
 * it anyway — e.g. "*[SPLASH SOUND]*", "[cut to]", "(laughs)". Left in, the
 * TTS engine reads these aloud literally, since it has no way to know they
 * weren't meant to be spoken. Prompt instructions are a hint, not a
 * guarantee, so strip anything bracket- or asterisk-wrapped as a real
 * guardrail rather than relying on compliance alone. */
function stripStageDirections(text: string): string {
  return text
    .replace(/\*\[[^\]]*\]\*/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/\*([^*]*)\*/g, "$1")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,!?])/g, "$1")
    .trim();
}

const HOOKS = [
  "Nobody's telling you this, but",
  "Here's what changed everything for me:",
  "Stop scrolling — you need to hear this.",
  "This one idea will save you hours:",
  "I wish someone told me this sooner:",
];

function mockScript(topic: string): ScriptResult {
  const hook = HOOKS[Math.floor(Math.random() * HOOKS.length)];
  const clean = topic.trim().replace(/\s+/g, " ");
  const script = [
    `${hook} ${clean}.`,
    `Most people get this wrong because they overcomplicate it from the start.`,
    `Here's the simple version: focus on the one thing that actually moves the needle, and ignore the rest.`,
    `Once you do that, everything else gets easier — and faster.`,
    `Try it today, and tell me how it goes.`,
  ].join(" ");

  const words = clean.split(" ").filter(Boolean).slice(0, 6);
  const sceneKeywords = words.length > 0 ? words : ["idea", "focus", "growth"];

  return {
    title: clean.slice(0, 60) || "Untitled video",
    script,
    sceneKeywords,
    provider: "mock",
    inputTokens: null,
    outputTokens: null,
  };
}

function mockAdScript(productName: string, sellingPoints: string): ScriptResult {
  const points = sellingPoints
    .split(/[,\n]/)
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(0, 3);

  const script = [
    `Okay I have to talk about ${productName} for a second.`,
    points.length > 0 ? `Here's why it's worth it: ${points.join(". ")}.` : `It solves a problem I didn't even know I had.`,
    `I was skeptical at first, but it's actually delivered on everything it promised.`,
    `If you've been on the fence, this is your sign to try ${productName}.`,
  ].join(" ");

  return {
    title: `${productName} — UGC ad`,
    script,
    sceneKeywords: [productName, ...points].slice(0, 5),
    provider: "mock",
    inputTokens: null,
    outputTokens: null,
  };
}

/** Extracts the typed fields from a parsed LLM JSON response, falling back to
 * the provided fallback for any field that is missing or the wrong type. */
function parseScriptResult(parsed: Record<string, unknown>, fallback: ScriptResult): Omit<ScriptResult, "provider" | "inputTokens" | "outputTokens"> {
  return {
    title: typeof parsed.title === "string" ? parsed.title : fallback.title,
    script: stripStageDirections(typeof parsed.script === "string" ? parsed.script : fallback.script),
    sceneKeywords:
      Array.isArray(parsed.sceneKeywords) && parsed.sceneKeywords.length > 0
        ? (parsed.sceneKeywords as string[])
        : fallback.sceneKeywords,
  };
}

export async function generateAdScript(productName: string, sellingPoints: string): Promise<ScriptResult> {
  const fallback = mockAdScript(productName, sellingPoints);
  const messages: { role: "system" | "user"; content: string }[] = [
    {
      role: "system",
      content:
        "You write short, authentic-sounding UGC-style ad voiceover scripts (like a real customer talking to camera), " +
        "for a 20-30 second vertical ad. Return strict JSON with keys: title (<60 chars), script (plain spoken text, " +
        "60-90 words, first person, no stage directions), sceneKeywords (4-5 short visual keywords for stock footage).",
    },
    { role: "user", content: `Product: ${productName}\nKey selling points: ${sellingPoints}` },
  ];

  const meta = await chatJSONWithMeta(messages, 0.9);
  if (!meta) return fallback;

  return {
    ...parseScriptResult(meta.data, fallback),
    provider: meta.provider,
    inputTokens: meta.inputTokens,
    outputTokens: meta.outputTokens,
  };
}

/** Generates an original script inspired by a Trend Radar pattern — structure,
 * hook type, and pacing only, never the source content itself (the caller
 * never even has source text to leak; ExtractedPattern is all that's ever
 * persisted from a trend video, see lib/providers/pattern-extraction.ts).
 * The system prompt explicitly forbids paraphrasing the source, and the
 * caller (app/api/trend/make-version/route.ts) runs checkTextOverlap() on
 * the result as a second guardrail layer before it's ever shown to a user. */
export async function generateScriptFromPattern(
  pattern: {
    hookType: string;
    structure: string;
    pacingNotes: string;
    titleFormula: string;
    thumbnailFormula: string;
    emotionalDriver: string;
  },
  niche: string
): Promise<ScriptResult> {
  const fallback = mockScript(niche);

  // chatJSON (not chatJSONWithMeta) intentionally — this is a Trend Radar
  // background feature that doesn't need per-call cost tracking today.
  const parsed = await chatJSON(
    [
      {
        role: "system",
        content:
          "You write short, punchy scripts for 30-45 second vertical social videos (TikTok/Reels/Shorts). " +
          "You'll be given a STRUCTURAL PATTERN (hook type, pacing, emotional driver) that worked well for another " +
          "creator, and a topic niche. Write a wholly original script in that structural style, on a fresh angle " +
          "within the niche — never reuse or paraphrase any specific wording, examples, or claims from elsewhere; " +
          "only the pacing/structure/hook-type pattern should carry over. The script will be read verbatim by a " +
          "text-to-speech engine, so it must be ONLY the literal words to be spoken out loud — no bracketed sound " +
          "cues, no camera directions, no parenthetical asides, no asterisk-wrapped emphasis or actions of any " +
          "kind. If a beat needs a sound effect or cut, convey it through the spoken words themselves instead. " +
          "Return strict JSON with keys: title (short, <60 chars), script (plain spoken text only, 70-110 words), " +
          "sceneKeywords (array of 4-6 short visual keywords for stock footage search).",
      },
      {
        role: "user",
        content:
          `Niche: ${niche}\n\nPattern to draw structural inspiration from:\n` +
          `- Hook type: ${pattern.hookType}\n- Structure: ${pattern.structure}\n- Pacing: ${pattern.pacingNotes}\n` +
          `- Title formula: ${pattern.titleFormula}\n- Emotional driver: ${pattern.emotionalDriver}`,
      },
    ],
    0.9
  );

  if (!parsed) return fallback;

  return {
    ...parseScriptResult(parsed, fallback),
    // provider/tokens not tracked for background Trend Radar calls
  };
}

export async function generateScript(
  topic: string,
  useFreeOnly = false,
  languageLabel = "English"
): Promise<ScriptResult> {
  const fallback = mockScript(topic);
  const languageInstruction =
    languageLabel === "English" ? "" : ` Write the script itself entirely in ${languageLabel}.`;
  const messages: { role: "system" | "user"; content: string }[] = [
    {
      role: "system",
      content:
        "You write short, punchy scripts for 30-45 second vertical social videos (TikTok/Reels/Shorts). " +
        "Return strict JSON with keys: title (short, <60 chars), script (plain spoken text, no stage directions, 70-110 words), " +
        `sceneKeywords (array of 4-6 short visual keywords for stock footage search, based on the script — always in English, ` +
        `regardless of the script's language, since they're used for an English-only stock footage search).${languageInstruction}`,
    },
    { role: "user", content: `Topic or source text:\n\n${topic}` },
  ];

  if (useFreeOnly) {
    // Groq-only path — chatJSONFree never touches the paid OpenAI key.
    // Token counts aren't surfaced here; provider is fixed as "groq".
    const parsed = await chatJSONFree(messages);
    if (!parsed) return fallback;
    return { ...parseScriptResult(parsed, fallback), provider: "groq", inputTokens: null, outputTokens: null };
  }

  const meta = await chatJSONWithMeta(messages);
  if (!meta) return fallback;
  return {
    ...parseScriptResult(meta.data, fallback),
    provider: meta.provider,
    inputTokens: meta.inputTokens,
    outputTokens: meta.outputTokens,
  };
}
