import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { ok } = rateLimit(`roadmap-vote:${userId}`, 30, 60 * 1000);
  if (!ok) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  const existing = await db.featureVote.findUnique({
    where: { userId_featureRequestId: { userId, featureRequestId: id } },
  });

  if (existing) {
    await db.featureVote.delete({ where: { id: existing.id } });
    return NextResponse.json({ voted: false });
  }

  try {
    await db.featureVote.create({ data: { userId, featureRequestId: id } });
  } catch (err) {
    // P2003: the feature request's FK no longer resolves -- it was deleted
    // between page load and the click. Anything else (DB timeout, connection
    // drop, etc.) is a real failure and must not be reported as a vote.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") {
      return NextResponse.json({ error: "This feature request no longer exists" }, { status: 404 });
    }
    throw err;
  }
  return NextResponse.json({ voted: true });
}
