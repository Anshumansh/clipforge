import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { generateIdeas } from "@/lib/providers/ideas";
import { rateLimit } from "@/lib/rate-limit";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Free feature (no credit charge) but still capped — it's a real LLM call.
  const { ok } = rateLimit(`ideas:${userId}`, 10, 60 * 1000);
  if (!ok) return NextResponse.json({ error: "Too many requests. Slow down and try again shortly." }, { status: 429 });

  const body = await req.json().catch(() => ({}));
  const niche = typeof body.niche === "string" ? body.niche.slice(0, 200) : undefined;

  const ideas = await generateIdeas(niche);
  return NextResponse.json({ ideas });
}
