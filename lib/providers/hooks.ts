import { chatJSON } from "./llm";

const MOCK_HOOKS = [
  "Nobody's telling you this, but",
  "Stop scrolling — you need to hear this.",
  "I wish someone told me this sooner:",
];

/** Generates 3 alternate opening hooks for a topic, so a user can pick the
 * strongest one before spending credits on a full render — text-only LLM call,
 * cheap enough to offer for free. */
export async function generateHookVariants(topic: string): Promise<string[]> {
  const parsed = await chatJSON(
    [
      {
        role: "system",
        content:
          "You write scroll-stopping opening lines (hooks) for short-form vertical videos (TikTok/Reels/Shorts). " +
          "Given a topic, return strict JSON with key 'hooks': an array of exactly 3 distinct single-sentence hooks " +
          "(under 15 words each) that could open a video about it. Vary the angle: e.g. one curiosity gap, one bold " +
          "claim, one direct callout to the viewer.",
      },
      { role: "user", content: `Topic: ${topic}` },
    ],
    1.0
  );

  const hooks = parsed?.hooks;
  if (!Array.isArray(hooks) || hooks.length === 0) return MOCK_HOOKS;

  return hooks.filter((h): h is string => typeof h === "string" && h.trim().length > 0).slice(0, 3);
}
