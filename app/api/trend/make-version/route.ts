import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { getVideosStats } from "@/lib/providers/youtube";
import { extractPattern } from "@/lib/providers/pattern-extraction";
import { generateScriptFromPattern } from "@/lib/providers/script";
import { checkTextOverlap } from "@/lib/providers/pattern-extraction";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Free (no credit charge — only the eventual render costs credits, same as
  // Idea Radar and hook variants) but still capped, since it's a real LLM call.
  const { ok } = rateLimit(`make-version:${userId}`, 10, 60 * 1000);
  if (!ok) return NextResponse.json({ error: "Too many requests. Slow down and try again shortly." }, { status: 429 });

  const body = await req.json().catch(() => ({}));
  const videoId = typeof body.videoId === "string" ? body.videoId : "";
  if (!videoId) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const video = await db.youtubeVideo.findUnique({ where: { id: videoId }, include: { pattern: true } });
  if (!video) return NextResponse.json({ error: "Video not found" }, { status: 404 });

  const userNiche = await db.userNiche.findUnique({ where: { userId } });
  const niche = userNiche?.niche ?? video.title;

  let pattern = video.pattern;
  let sourceDescription = "";

  // Lazy extraction: the scheduled ingestion job only extracts patterns for
  // videos that already cleared the breakout threshold (cost control for an
  // unattended background job). A user tapping "Make My Version" is a direct,
  // one-off request — extract on demand here so the feature has value even
  // for a video the batch job hasn't gotten to yet, rather than making users
  // wait on cron timing. Still free (Groq-only, same as the batch path).
  if (!pattern) {
    const [freshStats] = await getVideosStats([videoId]).catch(() => []);
    if (!freshStats) return NextResponse.json({ error: "Couldn't fetch this video's details" }, { status: 502 });
    sourceDescription = freshStats.description;

    const extracted = await extractPattern(freshStats);
    if (!extracted) {
      return NextResponse.json(
        { error: "Pattern analysis isn't available right now — try again later" },
        { status: 503 }
      );
    }
    pattern = await db.extractedPattern.create({ data: { videoId, ...extracted } });
  }

  let script = await generateScriptFromPattern(pattern, niche);
  let overlap = checkTextOverlap(script.script, [video.title, sourceDescription].filter(Boolean));

  if (overlap.flagged) {
    // One retry with a stronger uniqueness push before we just warn the user —
    // cheap enough (this is still Groq/OpenAI's usual tier of cost) and often
    // fixes it outright.
    script = await generateScriptFromPattern(pattern, `${niche} — use a completely different angle and wording`);
    overlap = checkTextOverlap(script.script, [video.title, sourceDescription].filter(Boolean));
  }

  return NextResponse.json({
    title: script.title,
    topic: script.script,
    flagged: overlap.flagged,
  });
}
