import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

async function loadInvite(token: string) {
  const invite = await db.workspaceInvite.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { workspace: { include: { owner: { select: { email: true, name: true } } } } },
  });
  return invite;
}

// Unauthenticated on purpose -- the invite page needs to show "you've been
// invited to X's workspace" before the visitor has necessarily registered
// or logged in yet.
export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const invite = await loadInvite(params.token);
  if (!invite) return NextResponse.json({ error: "Invite not found" }, { status: 404 });
  if (invite.acceptedAt) return NextResponse.json({ error: "This invite has already been used" }, { status: 410 });
  if (invite.expiresAt < new Date()) return NextResponse.json({ error: "This invite has expired" }, { status: 410 });

  return NextResponse.json({
    email: invite.email,
    workspaceName: invite.workspace.name,
    ownerName: invite.workspace.owner.name ?? invite.workspace.owner.email,
  });
}

export async function POST(_req: Request, { params }: { params: { token: string } }) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Log in first" }, { status: 401 });

  const invite = await loadInvite(params.token);
  if (!invite) return NextResponse.json({ error: "Invite not found" }, { status: 404 });
  if (invite.acceptedAt) return NextResponse.json({ error: "This invite has already been used" }, { status: 410 });
  if (invite.expiresAt < new Date()) return NextResponse.json({ error: "This invite has expired" }, { status: 410 });

  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.email.toLowerCase() !== invite.email.toLowerCase()) {
    return NextResponse.json({ error: `This invite is for ${invite.email} -- log in with that email to accept it.` }, { status: 403 });
  }

  const alreadyInAWorkspace = await db.workspaceMember.findUnique({ where: { userId } });
  if (alreadyInAWorkspace) {
    return NextResponse.json({ error: "You're already in a workspace -- leave it first to join a different one" }, { status: 400 });
  }
  const ownsAWorkspace = await db.workspace.findUnique({ where: { ownerId: userId } });
  if (ownsAWorkspace) {
    return NextResponse.json({ error: "You already own a workspace" }, { status: 400 });
  }

  await db.$transaction([
    db.workspaceMember.create({ data: { workspaceId: invite.workspaceId, userId } }),
    db.workspaceInvite.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } }),
  ]);

  return NextResponse.json({ ok: true, workspaceName: invite.workspace.name });
}
