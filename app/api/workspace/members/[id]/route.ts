import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

// Owner-only: removes a member by their WorkspaceMember row id.
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const member = await db.workspaceMember.findUnique({
    where: { id: params.id },
    include: { workspace: true },
  });
  if (!member || member.workspace.ownerId !== userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await db.workspaceMember.delete({ where: { id: member.id } });
  return NextResponse.json({ ok: true });
}
