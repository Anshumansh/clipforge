import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { resolveChannel, isYouTubeConfigured } from "@/lib/providers/youtube";
import { rateLimit } from "@/lib/rate-limit";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { ok } = rateLimit(`resolve-channel:${userId}`, 20, 60 * 1000);
  if (!ok) return NextResponse.json({ error: "Too many requests. Slow down and try again shortly." }, { status: 429 });

  const body = await req.json().catch(() => ({}));
  const input = typeof body.input === "string" ? body.input.slice(0, 200) : "";
  if (!input) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  if (!isYouTubeConfigured()) {
    return NextResponse.json({ error: "Trend Radar isn't configured on this server yet" }, { status: 503 });
  }

  const channel = await resolveChannel(input);
  if (!channel) return NextResponse.json({ error: "Couldn't find that channel — check the URL or handle" }, { status: 404 });

  return NextResponse.json({ channel });
}
