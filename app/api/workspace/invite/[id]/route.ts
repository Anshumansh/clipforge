import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

// Owner-only: cancels a pending invite by its own id -- distinct from the
// token-based accept flow in app/api/workspace/invites/[token], since the
// owner never has the raw token (only its hash is stored, same as a
// password reset token).
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const invite = await db.workspaceInvite.findUnique({ where: { id: params.id }, include: { workspace: true } });
  if (!invite || invite.workspace.ownerId !== userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await db.workspaceInvite.delete({ where: { id: invite.id } });
  return NextResponse.json({ ok: true });
}
