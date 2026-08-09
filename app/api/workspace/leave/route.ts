import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

// Member-only: leaves whatever workspace the caller belongs to. Their own
// projects keep workspaceId set (still visible to the workspace they left,
// same as any other member's contribution) -- leaving only removes their
// own future access and billing tie to the owner, it doesn't retroactively
// unshare what they already made.
export async function POST() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const membership = await db.workspaceMember.findUnique({ where: { userId } });
  if (!membership) return NextResponse.json({ error: "You're not in a workspace" }, { status: 400 });

  await db.workspaceMember.delete({ where: { id: membership.id } });
  return NextResponse.json({ ok: true });
}
