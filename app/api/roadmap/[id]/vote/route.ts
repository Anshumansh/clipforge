import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { ok } = rateLimit(`roadmap-vote:${userId}`, 30, 60 * 1000);
  if (!ok) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  const existing = await db.featureVote.findUnique({
    where: { userId_featureRequestId: { userId, featureRequestId: params.id } },
  });

  if (existing) {
    await db.featureVote.delete({ where: { id: existing.id } });
    return NextResponse.json({ voted: false });
  }

  await db.featureVote.create({ data: { userId, featureRequestId: params.id } }).catch(() => {
    // Request was deleted between page load and the click -- nothing to vote on.
  });
  return NextResponse.json({ voted: true });
}
