import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const key = await db.apiKey.findFirst({ where: { id, userId } });
  if (!key) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db.apiKey.delete({ where: { id: key.id } });
  return NextResponse.json({ ok: true });
}
