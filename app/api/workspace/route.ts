import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { canCreateWorkspace } from "@/lib/plans";

async function requireSessionUserId(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  return (session?.user as { id?: string } | undefined)?.id ?? null;
}

export async function GET() {
  const userId = await requireSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [user, owned, membership] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: userId }, select: { plan: true } }),
    db.workspace.findUnique({
      where: { ownerId: userId },
      include: {
        members: { include: { user: { select: { id: true, email: true, name: true } } } },
        invites: { where: { acceptedAt: null }, orderBy: { createdAt: "desc" } },
      },
    }),
    db.workspaceMember.findUnique({
      where: { userId },
      include: { workspace: { include: { owner: { select: { email: true, name: true } } } } },
    }),
  ]);

  if (owned) {
    return NextResponse.json({
      role: "owner",
      workspace: { id: owned.id, name: owned.name },
      members: owned.members.map((m) => ({ id: m.id, email: m.user.email, name: m.user.name, joinedAt: m.joinedAt })),
      pendingInvites: owned.invites.map((i) => ({ id: i.id, email: i.email, createdAt: i.createdAt, expiresAt: i.expiresAt })),
      canCreate: canCreateWorkspace(user.plan),
    });
  }

  if (membership) {
    return NextResponse.json({
      role: "member",
      workspace: {
        id: membership.workspace.id,
        name: membership.workspace.name,
        ownerEmail: membership.workspace.owner.email,
        ownerName: membership.workspace.owner.name,
      },
      members: [],
      pendingInvites: [],
      canCreate: canCreateWorkspace(user.plan),
    });
  }

  return NextResponse.json({ role: null, workspace: null, members: [], pendingInvites: [], canCreate: canCreateWorkspace(user.plan) });
}

export async function POST(req: Request) {
  const userId = await requireSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  if (!canCreateWorkspace(user.plan)) {
    return NextResponse.json({ error: "Team workspaces are a Business-plan feature" }, { status: 403 });
  }

  const existing = await db.workspace.findUnique({ where: { ownerId: userId } });
  if (existing) return NextResponse.json({ error: "You already have a workspace" }, { status: 400 });

  const alreadyMember = await db.workspaceMember.findUnique({ where: { userId } });
  if (alreadyMember) {
    return NextResponse.json({ error: "You're already a member of another workspace -- leave it first" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 60) : "";
  if (!name) return NextResponse.json({ error: "A workspace name is required" }, { status: 400 });

  const workspace = await db.workspace.create({ data: { name, ownerId: userId } });
  return NextResponse.json({ id: workspace.id, name: workspace.name });
}

export async function DELETE() {
  const userId = await requireSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const workspace = await db.workspace.findUnique({ where: { ownerId: userId } });
  if (!workspace) return NextResponse.json({ error: "No workspace to delete" }, { status: 404 });

  // Members' own projects survive via Project.workspaceId's SetNull cascade
  // -- dissolving a workspace never deletes anyone's already-generated videos.
  await db.workspace.delete({ where: { id: workspace.id } });
  return NextResponse.json({ ok: true });
}
