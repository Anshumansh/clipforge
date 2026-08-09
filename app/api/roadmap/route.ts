import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { ok } = rateLimit(`roadmap-create:${userId}`, 5, 60 * 60 * 1000);
  if (!ok) return NextResponse.json({ error: "Too many requests. Slow down and try again shortly." }, { status: 429 });

  const body = await req.json().catch(() => ({}));
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";

  if (title.length < 5 || title.length > 120) {
    return NextResponse.json({ error: "Title must be 5-120 characters." }, { status: 400 });
  }
  if (description.length > 1000) {
    return NextResponse.json({ error: "Description is too long (max 1000 characters)." }, { status: 400 });
  }

  const request = await db.featureRequest.create({
    data: { userId, title, description },
  });

  // The submitter's own vote is implicit -- otherwise every new request
  // would show 0 votes even from the person who cared enough to write it.
  await db.featureVote.create({ data: { userId, featureRequestId: request.id } });

  return NextResponse.json({ id: request.id });
}
