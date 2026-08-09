import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { generateApiKey } from "@/lib/api-keys";
import { canUseApiAccess } from "@/lib/plans";

// Deliberately session-only, not resolveApiUser -- key management must not
// be delegable to another API key. A leaked key should never be able to
// mint further keys or see other keys' labels/prefixes.
async function requireSessionUserId(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  return (session?.user as { id?: string } | undefined)?.id ?? null;
}

export async function GET() {
  const userId = await requireSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const keys = await db.apiKey.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: { id: true, label: true, keyPrefix: true, lastUsedAt: true, createdAt: true },
  });

  return NextResponse.json({ keys });
}

export async function POST(req: Request) {
  const userId = await requireSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  if (!canUseApiAccess(user.plan)) {
    return NextResponse.json({ error: "API access is a Business-plan feature" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const label = typeof body.label === "string" ? body.label.trim().slice(0, 60) : "";
  if (!label) return NextResponse.json({ error: "A label is required" }, { status: 400 });

  const { raw, hash, prefix } = generateApiKey();
  const key = await db.apiKey.create({
    data: { userId, label, keyHash: hash, keyPrefix: prefix },
  });

  // The only time the raw key is ever returned -- it's not retrievable again.
  return NextResponse.json({ id: key.id, label: key.label, keyPrefix: key.keyPrefix, raw });
}
