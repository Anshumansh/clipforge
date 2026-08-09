import { db } from "@/lib/db";

export interface WorkspaceContext {
  workspaceId: string;
  workspaceName: string;
  role: "owner" | "member";
  /** Whoever's credit balance gets debited when this user starts a render --
   * themselves if they're not in a workspace or they own it, otherwise the
   * workspace owner (see lib/plans.ts canCreateWorkspace). */
  creditOwnerId: string;
}

/** A user can be in at most one workspace -- either owning one or belonging
 * to one, never both, and never more than one of either (see the comment on
 * the Workspace model for why this is deliberately simple for v1). Returns
 * null for the common case of not being in a workspace at all. */
export async function getWorkspaceContext(userId: string): Promise<WorkspaceContext | null> {
  const owned = await db.workspace.findUnique({ where: { ownerId: userId } });
  if (owned) {
    return { workspaceId: owned.id, workspaceName: owned.name, role: "owner", creditOwnerId: userId };
  }

  const membership = await db.workspaceMember.findUnique({
    where: { userId },
    include: { workspace: true },
  });
  if (membership) {
    return {
      workspaceId: membership.workspaceId,
      workspaceName: membership.workspace.name,
      role: "member",
      creditOwnerId: membership.workspace.ownerId,
    };
  }

  return null;
}

/** Which User.id a render's credits should be charged against -- the
 * workspace owner's if the caller is a member of one, otherwise their own.
 * Used at every credit-charging call site instead of the raw session
 * userId, so joining a workspace changes billing with zero other code
 * changes to lib/credits.ts itself. */
export async function resolveCreditOwnerId(userId: string): Promise<string> {
  const ctx = await getWorkspaceContext(userId);
  return ctx?.creditOwnerId ?? userId;
}

export interface GenerationContext {
  creditOwnerId: string;
  /** The plan whose feature gates (aspect ratio, voice cloning, watermark,
   * brand kit) apply to this render -- the workspace owner's plan for a
   * member, since they're spending the owner's credits and should get the
   * owner's tier of service, not be silently downgraded to their own. */
  effectivePlan: string;
  workspaceId: string | null;
}

/** One resolution per generation request instead of duplicating workspace
 * lookups at every plan-gate check. `ownPlan` is the caller's own plan,
 * already known by the route (avoids a redundant User fetch when they're
 * not in a workspace, the common case). */
export async function resolveGenerationContext(userId: string, ownPlan: string): Promise<GenerationContext> {
  const ctx = await getWorkspaceContext(userId);
  if (!ctx) return { creditOwnerId: userId, effectivePlan: ownPlan, workspaceId: null };
  if (ctx.role === "owner") return { creditOwnerId: userId, effectivePlan: ownPlan, workspaceId: ctx.workspaceId };

  const owner = await db.user.findUniqueOrThrow({ where: { id: ctx.creditOwnerId }, select: { plan: true } });
  return { creditOwnerId: ctx.creditOwnerId, effectivePlan: owner.plan, workspaceId: ctx.workspaceId };
}

/** Ownership filter for fetching a single project by id -- includes
 * workspace-shared projects (any teammate's, not just the caller's own)
 * when the caller is in a workspace, otherwise just their own. Spread
 * alongside `id` in a `db.project.findFirst({ where: { id, ...filter } })`
 * call so every project-by-id route (dashboard page, export, thumbnail,
 * status API) grants the same access a teammate sees in the project list. */
export async function projectAccessFilter(userId: string): Promise<{ userId: string } | { OR: [{ userId: string }, { workspaceId: string }] }> {
  const ctx = await getWorkspaceContext(userId);
  return ctx ? { OR: [{ userId }, { workspaceId: ctx.workspaceId }] } : { userId };
}
