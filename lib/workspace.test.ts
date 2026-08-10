import { describe, it, expect, vi, beforeEach } from "vitest";

const workspaceFindUnique = vi.fn();
const workspaceMemberFindUnique = vi.fn();
const userFindUniqueOrThrow = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    workspace: { findUnique: (...args: unknown[]) => workspaceFindUnique(...args) },
    workspaceMember: { findUnique: (...args: unknown[]) => workspaceMemberFindUnique(...args) },
    user: { findUniqueOrThrow: (...args: unknown[]) => userFindUniqueOrThrow(...args) },
  },
}));

const { resolveProjectCreditOwnerId, getWorkspaceContext, resolveGenerationContext, projectAccessFilter } =
  await import("./workspace");

beforeEach(() => {
  workspaceFindUnique.mockReset();
  workspaceMemberFindUnique.mockReset();
  userFindUniqueOrThrow.mockReset();
});

describe("resolveProjectCreditOwnerId", () => {
  it("returns the project's own userId for a personal (non-workspace) project", async () => {
    const owner = await resolveProjectCreditOwnerId({ userId: "user-1", workspaceId: null });
    expect(owner).toBe("user-1");
    expect(workspaceFindUnique).not.toHaveBeenCalled();
  });

  it("returns the workspace owner recorded on the project, not the caller", async () => {
    workspaceFindUnique.mockResolvedValue({ ownerId: "owner-1" });

    const owner = await resolveProjectCreditOwnerId({ userId: "member-1", workspaceId: "ws-1" });

    expect(owner).toBe("owner-1");
    expect(workspaceFindUnique).toHaveBeenCalledWith({ where: { id: "ws-1" }, select: { ownerId: true } });
  });

  it("falls back to the project's own userId if the workspace no longer exists", async () => {
    workspaceFindUnique.mockResolvedValue(null);

    const owner = await resolveProjectCreditOwnerId({ userId: "member-1", workspaceId: "deleted-ws" });

    expect(owner).toBe("member-1");
  });
});

// These are the cross-tenant boundary functions: every one of them decides
// whether a caller can see, spend against, or inherit the plan tier of an
// account that isn't their own. A bug here is a real IDOR / billing leak,
// not a cosmetic issue -- these tests exist specifically to pin down that a
// user with no workspace can never be resolved into someone else's context,
// and a workspace member is always resolved to the OWNER's billing/plan
// identity, never their own, even though they're the one making the request.
describe("getWorkspaceContext", () => {
  it("returns null for a user with no workspace -- never silently defaults to someone else's", async () => {
    workspaceFindUnique.mockResolvedValue(null);
    workspaceMemberFindUnique.mockResolvedValue(null);

    const ctx = await getWorkspaceContext("solo-user");

    expect(ctx).toBeNull();
  });

  it("resolves an owner to their own workspace with themself as credit owner", async () => {
    workspaceFindUnique.mockResolvedValue({ id: "ws-1", name: "Acme", ownerId: "owner-1" });

    const ctx = await getWorkspaceContext("owner-1");

    expect(ctx).toEqual({ workspaceId: "ws-1", workspaceName: "Acme", role: "owner", creditOwnerId: "owner-1" });
  });

  it("resolves a member to the OWNER as credit owner, not themselves", async () => {
    workspaceFindUnique.mockResolvedValue(null); // not an owner
    workspaceMemberFindUnique.mockResolvedValue({
      workspaceId: "ws-1",
      workspace: { id: "ws-1", name: "Acme", ownerId: "owner-1" },
    });

    const ctx = await getWorkspaceContext("member-1");

    expect(ctx?.role).toBe("member");
    expect(ctx?.creditOwnerId).toBe("owner-1");
    expect(ctx?.creditOwnerId).not.toBe("member-1");
  });
});

describe("resolveGenerationContext", () => {
  it("a solo user (no workspace) is charged as themselves on their own plan", async () => {
    workspaceFindUnique.mockResolvedValue(null);
    workspaceMemberFindUnique.mockResolvedValue(null);

    const genCtx = await resolveGenerationContext("solo-user", "free");

    expect(genCtx).toEqual({ creditOwnerId: "solo-user", effectivePlan: "free", workspaceId: null });
  });

  it("a workspace owner is charged as themselves on their own plan", async () => {
    workspaceFindUnique.mockResolvedValue({ id: "ws-1", name: "Acme", ownerId: "owner-1" });

    const genCtx = await resolveGenerationContext("owner-1", "business");

    expect(genCtx.creditOwnerId).toBe("owner-1");
    expect(genCtx.effectivePlan).toBe("business");
  });

  it("a workspace member is charged to the OWNER and inherits the OWNER's plan, not their own", async () => {
    workspaceFindUnique.mockResolvedValue(null);
    workspaceMemberFindUnique.mockResolvedValue({
      workspaceId: "ws-1",
      workspace: { id: "ws-1", name: "Acme", ownerId: "owner-1" },
    });
    userFindUniqueOrThrow.mockResolvedValue({ plan: "business" });

    // The member's own plan is "free" -- if this leaked through instead of
    // the owner's plan, a free member would silently get watermarked,
    // lower-tier renders while still spending the owner's Business credits.
    const genCtx = await resolveGenerationContext("member-1", "free");

    expect(genCtx.creditOwnerId).toBe("owner-1");
    expect(genCtx.effectivePlan).toBe("business");
    expect(genCtx.effectivePlan).not.toBe("free");
  });
});

describe("projectAccessFilter", () => {
  it("restricts a solo user to only their own projects", async () => {
    workspaceFindUnique.mockResolvedValue(null);
    workspaceMemberFindUnique.mockResolvedValue(null);

    const filter = await projectAccessFilter("solo-user");

    expect(filter).toEqual({ userId: "solo-user" });
  });

  it("a workspace member's filter is scoped to their OWN workspace's id, never attacker-suppliable", async () => {
    workspaceFindUnique.mockResolvedValue(null);
    workspaceMemberFindUnique.mockResolvedValue({
      workspaceId: "ws-1",
      workspace: { id: "ws-1", name: "Acme", ownerId: "owner-1" },
    });

    const filter = await projectAccessFilter("member-1");

    // The workspaceId here comes from a DB lookup keyed by the caller's own
    // userId -- there is no code path where a caller can pass in a
    // workspaceId of their choosing to see into a workspace they're not in.
    expect(filter).toEqual({ OR: [{ userId: "member-1" }, { workspaceId: "ws-1" }] });
  });
});
