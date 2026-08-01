import { chatJSON } from "./llm";
import type { ScriptResult } from "./types";

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
  };
}

export async function generateAdScript(productName: string, sellingPoints: string): Promise<ScriptResult> {
  const fallback = mockAdScript(productName, sellingPoints);

  const parsed = await chatJSON(
    [
      {
        role: "system",
        content:
          "You write short, authentic-sounding UGC-style ad voiceover scripts (like a real customer talking to camera), " +
          "for a 20-30 second vertical ad. Return strict JSON with keys: title (<60 chars), script (plain spoken text, " +
          "60-90 words, first person, no stage directions), sceneKeywords (4-5 short visual keywords for stock footage).",
      },
      { role: "user", content: `Product: ${productName}\nKey selling points: ${sellingPoints}` },
    ],
    0.9
  );

  if (!parsed) return fallback;

  return {
    title: typeof parsed.title === "string" ? parsed.title : fallback.title,
    script: typeof parsed.script === "string" ? parsed.script : fallback.script,
    sceneKeywords:
      Array.isArray(parsed.sceneKeywords) && parsed.sceneKeywords.length > 0
        ? (parsed.sceneKeywords as string[])
        : fallback.sceneKeywords,
  };
}

export async function generateScript(topic: string): Promise<ScriptResult> {
  const fallback = mockScript(topic);

  const parsed = await chatJSON([
    {
      role: "system",
      content:
        "You write short, punchy scripts for 30-45 second vertical social videos (TikTok/Reels/Shorts). " +
        "Return strict JSON with keys: title (short, <60 chars), script (plain spoken text, no stage directions, 70-110 words), " +
        "sceneKeywords (array of 4-6 short visual keywords for stock footage search, based on the script).",
    },
    { role: "user", content: `Topic or source text:\n\n${topic}` },
  ]);

  if (!parsed) return fallback;

  return {
    title: typeof parsed.title === "string" ? parsed.title : fallback.title,
    script: typeof parsed.script === "string" ? parsed.script : fallback.script,
    sceneKeywords:
      Array.isArray(parsed.sceneKeywords) && parsed.sceneKeywords.length > 0
        ? (parsed.sceneKeywords as string[])
        : fallback.sceneKeywords,
  };
}
