import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { ingestChannels } from "@/lib/trend/ingest";

const MAX_CHANNELS = 10;

export async function GET() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userNiche = await db.userNiche.findUnique({
    where: { userId },
    include: { trackedChannels: true },
  });

  return NextResponse.json({
    niche: userNiche?.niche ?? null,
    channels: userNiche?.trackedChannels.map((c) => ({ id: c.youtubeChannelId, title: c.channelTitle })) ?? [],
  });
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { ok } = rateLimit(`trend-onboarding:${userId}`, 5, 60 * 1000);
  if (!ok) return NextResponse.json({ error: "Too many requests. Slow down and try again shortly." }, { status: 429 });

  const body = await req.json().catch(() => ({}));
  const niche = typeof body.niche === "string" ? body.niche.trim().slice(0, 200) : "";
  const channels = Array.isArray(body.channels) ? body.channels : [];

  if (!niche) return NextResponse.json({ error: "Pick a niche" }, { status: 400 });
  if (channels.length > MAX_CHANNELS) {
    return NextResponse.json({ error: `Up to ${MAX_CHANNELS} channels` }, { status: 400 });
  }
  const validChannels = (channels as unknown[]).filter(
    (c): c is { id: string; title?: string } =>
      typeof c === "object" && c !== null && typeof (c as { id?: unknown }).id === "string"
  );

  const userNiche = await db.userNiche.upsert({
    where: { userId },
    create: { userId, niche },
    update: { niche },
  });

  // Replace the tracked-channel set wholesale — simpler and safer than diffing,
  // and this only ever runs from an explicit "save" action, not per-keystroke.
  await db.trackedChannel.deleteMany({ where: { userNicheId: userNiche.id } });
  if (validChannels.length > 0) {
    await db.trackedChannel.createMany({
      data: validChannels.map((c) => ({
        userNicheId: userNiche.id,
        youtubeChannelId: c.id,
        channelTitle: c.title ?? null,
      })),
    });
  }

  // Immediate first-scan so the feed has something to show right away instead
  // of waiting for the next scheduled cron cycle (up to 3h away). Breakout
  // *detection* still needs real time to build a baseline (see the feed
  // route's "gathering data" state) — this just gets the videos themselves
  // recorded now rather than later.
  let summary = null;
  try {
    summary = await ingestChannels(
      validChannels.map((c) => c.id),
      [niche]
    );
  } catch (err) {
    console.error("[trend-onboarding] first-scan failed:", err instanceof Error ? err.message : err);
  }

  return NextResponse.json({ ok: true, summary });
}
