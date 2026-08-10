import { describe, it, expect, vi, beforeEach } from "vitest";

const findUnique = vi.fn();

vi.mock("@/lib/db", () => ({
  db: { workspace: { findUnique: (...args: unknown[]) => findUnique(...args) } },
}));

const { resolveProjectCreditOwnerId } = await import("./workspace");

describe("resolveProjectCreditOwnerId", () => {
  beforeEach(() => {
    findUnique.mockReset();
  });

  it("returns the project's own userId for a personal (non-workspace) project", async () => {
    const owner = await resolveProjectCreditOwnerId({ userId: "user-1", workspaceId: null });
    expect(owner).toBe("user-1");
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("returns the workspace owner recorded on the project, not the caller", async () => {
    findUnique.mockResolvedValue({ ownerId: "owner-1" });

    const owner = await resolveProjectCreditOwnerId({ userId: "member-1", workspaceId: "ws-1" });

    expect(owner).toBe("owner-1");
    expect(findUnique).toHaveBeenCalledWith({ where: { id: "ws-1" }, select: { ownerId: true } });
  });

  it("falls back to the project's own userId if the workspace no longer exists", async () => {
    // Project.workspaceId uses onDelete: SetNull, so a project can be left
    // pointing at a workspace ID that's mid-delete -- refunding to the project's
    // own creator rather than throwing is the safe failure mode here.
    findUnique.mockResolvedValue(null);

    const owner = await resolveProjectCreditOwnerId({ userId: "member-1", workspaceId: "deleted-ws" });

    expect(owner).toBe("member-1");
  });
});
