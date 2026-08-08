import { chatJSON } from "./llm";

export interface VideoIdea {
  title: string;
  hook: string;
  description: string;
}

const MOCK_IDEAS: VideoIdea[] = [
  {
    title: "The 5-minute morning routine that actually sticks",
    hook: "Stop scrolling — you need to hear this.",
    description: "Break down one small, repeatable morning habit and why most people quit it too early.",
  },
  {
    title: "3 things nobody tells you before you start",
    hook: "I wish someone told me this sooner:",
    description: "A myth-busting list format — quick, punchy, and easy to relate to.",
  },
  {
    title: "Why I switched — and what changed",
    hook: "Okay I have to talk about this for a second.",
    description: "A first-person before/after story format, great for product or lifestyle angles.",
  },
];

function mockIdeas(niche?: string): VideoIdea[] {
  if (!niche) return MOCK_IDEAS;
  return MOCK_IDEAS.map((idea) => ({ ...idea, description: `${idea.description} (angle: ${niche})` }));
}

/** Generates a batch of fresh short-form video ideas — the "blank page" problem
 * is the single biggest thing stopping creators from posting daily, so this is
 * offered as a free planning step (no credit charge; only the render costs). */
export async function generateIdeas(niche?: string): Promise<VideoIdea[]> {
  const fallback = mockIdeas(niche);

  const parsed = await chatJSON(
    [
      {
        role: "system",
        content:
          "You are a short-form video strategist. Generate 6 distinct, specific, scroll-stopping video ideas for " +
          "TikTok/Reels/Shorts. Return strict JSON with key 'ideas': an array of 6 objects, each with keys: " +
          "title (<70 chars), hook (a punchy first spoken line, <15 words), description (1 sentence on the angle).",
      },
      {
        role: "user",
        content: niche
          ? `Niche or topic area: ${niche}`
          : "No specific niche given — cover a mix of broadly appealing topics (productivity, money, relationships, self-improvement, trends).",
      },
    ],
    1.0
  );

  const ideas = parsed?.ideas;
  if (!Array.isArray(ideas) || ideas.length === 0) return fallback;

  return ideas
    .filter((idea): idea is Record<string, unknown> => typeof idea === "object" && idea !== null)
    .map((idea) => ({
      title: typeof idea.title === "string" ? idea.title : "Untitled idea",
      hook: typeof idea.hook === "string" ? idea.hook : "",
      description: typeof idea.description === "string" ? idea.description : "",
    }))
    .slice(0, 8);
}
