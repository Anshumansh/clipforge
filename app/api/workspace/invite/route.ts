import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { sendWorkspaceInviteEmail, isEmailConfigured } from "@/lib/email";
import { requireVerifiedEmail, EmailNotVerifiedError } from "@/lib/email-verification";
import { canCreateWorkspace } from "@/lib/plans";

const schema = z.object({ email: z.string().email() });
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function getAppBaseUrl(): string {
  return (process.env.NEXTAUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    await requireVerifiedEmail(userId);
  } catch (err) {
    if (err instanceof EmailNotVerifiedError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }

  const { ok } = rateLimit(`workspace-invite:${userId}`, 10, 60 * 60 * 1000);
  if (!ok) return NextResponse.json({ error: "Too many invites sent. Try again later." }, { status: 429 });

  const user = await db.user.findUnique({ where: { id: userId }, select: { plan: true } });
  if (!user || !canCreateWorkspace(user.plan)) {
    return NextResponse.json({ error: "Team workspaces are a Business-plan feature" }, { status: 403 });
  }

  const workspace = await db.workspace.findUnique({ where: { ownerId: userId }, include: { owner: true } });
  if (!workspace) return NextResponse.json({ error: "You don't have a workspace yet" }, { status: 400 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "A valid email is required" }, { status: 400 });
  const email = parsed.data.email.toLowerCase();

  if (email === workspace.owner.email.toLowerCase()) {
    return NextResponse.json({ error: "That's your own email" }, { status: 400 });
  }

  const invitedUser = await db.user.findUnique({ where: { email } });
  if (invitedUser) {
    const existingMembership = await db.workspaceMember.findUnique({ where: { userId: invitedUser.id } });
    if (existingMembership?.workspaceId === workspace.id) {
      return NextResponse.json({ error: "That person is already a member" }, { status: 400 });
    }
    if (existingMembership) {
      return NextResponse.json({ error: "That person is already in another workspace" }, { status: 400 });
    }
    const ownsWorkspace = await db.workspace.findUnique({ where: { ownerId: invitedUser.id } });
    if (ownsWorkspace) {
      return NextResponse.json({ error: "That person already owns their own workspace" }, { status: 400 });
    }
  }

  const existingInvite = await db.workspaceInvite.findFirst({
    where: { workspaceId: workspace.id, email, acceptedAt: null },
  });
  if (existingInvite) {
    return NextResponse.json({ error: "An invite is already pending for that email" }, { status: 400 });
  }

  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

  await db.workspaceInvite.create({
    data: {
      workspaceId: workspace.id,
      email,
      tokenHash,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    },
  });

  const inviteUrl = `${getAppBaseUrl()}/invite/${rawToken}`;

  if (isEmailConfigured()) {
    try {
      await sendWorkspaceInviteEmail(email, workspace.owner.name ?? workspace.owner.email, workspace.name, inviteUrl);
    } catch (err) {
      console.error("[workspace-invite] failed to send email:", err instanceof Error ? err.message : err);
    }
  }

  return NextResponse.json({ ok: true, inviteUrl });
}
