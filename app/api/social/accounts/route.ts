import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { isSocialPlatform } from "@/lib/social/platforms";

export async function GET() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const accounts = await db.socialAccount.findMany({
    where: { userId },
    select: { id: true, platform: true, handle: true, createdAt: true },
  });

  return NextResponse.json({ accounts });
}

export async function DELETE(req: Request) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { platform } = await req.json().catch(() => ({}));
  if (!isSocialPlatform(platform)) return NextResponse.json({ error: "Unknown platform" }, { status: 400 });

  await db.socialAccount.deleteMany({ where: { userId, platform } });
  return NextResponse.json({ ok: true });
}
