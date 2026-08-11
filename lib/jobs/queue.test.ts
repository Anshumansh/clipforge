import { describe, it, expect, vi, beforeEach } from "vitest";

// ------------------------------------------------------------------
// Mocks — must be declared before any imports so vi.mock hoisting
// can capture the spy references in its factory closures.
// ------------------------------------------------------------------

// Default to [] so the module-level reconcileOrphanedJobs() call on import
// finds no orphans and exits cleanly without needing beforeEach to run first.
const jobFindMany = vi.fn().mockResolvedValue([]);
const jobUpdateMany = vi.fn().mockResolvedValue({ count: 0 });
const projectUpdateMany = vi.fn().mockResolvedValue({ count: 0 });
const jobUpdate = vi.fn().mockResolvedValue({});
// Default: no reservation found (legacy fallback path)
const reservationFindUnique = vi.fn().mockResolvedValue(null);

vi.mock("@/lib/db", () => ({
  db: {
    job: {
      findMany: (...args: unknown[]) => jobFindMany(...args),
      updateMany: (...args: unknown[]) => jobUpdateMany(...args),
      update: (...args: unknown[]) => jobUpdate(...args),
    },
    project: {
      updateMany: (...args: unknown[]) => projectUpdateMany(...args),
    },
    creditReservation: {
      findUnique: (...args: unknown[]) => reservationFindUnique(...args),
    },
  },
}));

vi.mock("@/lib/credits", () => ({
  refundCredits: vi.fn(),
  CREDITS_PER_VIDEO: 10,
}));

vi.mock("@/lib/workspace", () => ({
  resolveProjectCreditOwnerId: vi.fn(),
}));

vi.mock("@/lib/pricing/ledger", () => ({
  releaseReservation: vi.fn(),
}));

// The runner imports are only needed for enqueueJob; stub them to avoid
// pulling in the full Remotion/TensorFlow dependency tree.
vi.mock("./script-runner", () => ({ runScriptJob: vi.fn() }));
vi.mock("./repurpose-runner", () => ({ runRepurposeJob: vi.fn() }));
vi.mock("./ugc-runner", () => ({ runUgcJob: vi.fn() }));

// ------------------------------------------------------------------
// Import AFTER mocks so the module-level reconciliation uses the
// mocked db. reservationFindUnique defaults to null (no reservation).
// ------------------------------------------------------------------

import { refundCredits } from "@/lib/credits";
import { resolveProjectCreditOwnerId } from "@/lib/workspace";
import { releaseReservation } from "@/lib/pricing/ledger";

const mockRefund = refundCredits as ReturnType<typeof vi.fn>;
const mockResolve = resolveProjectCreditOwnerId as ReturnType<typeof vi.fn>;
const mockRelease = releaseReservation as ReturnType<typeof vi.fn>;

const { reconcileOrphanedJobs } = await import("@/lib/jobs/queue");

// ------------------------------------------------------------------
// Tests
// ------------------------------------------------------------------

describe("reconcileOrphanedJobs", () => {
  beforeEach(() => {
    vi.resetAllMocks();

    jobFindMany.mockResolvedValue([]);
    jobUpdateMany.mockResolvedValue({ count: 0 });
    projectUpdateMany.mockResolvedValue({ count: 0 });
    jobUpdate.mockResolvedValue({});
    reservationFindUnique.mockResolvedValue(null); // default: no reservation (legacy path)

    mockResolve.mockImplementation(async (project: { userId: string }) => project.userId);
    mockRefund.mockResolvedValue(undefined);
    mockRelease.mockResolvedValue(undefined);
  });

  it("does nothing when there are no orphaned jobs", async () => {
    jobFindMany.mockResolvedValue([]);
    await reconcileOrphanedJobs();
    expect(jobUpdateMany).not.toHaveBeenCalled();
    expect(mockRefund).not.toHaveBeenCalled();
    expect(mockRelease).not.toHaveBeenCalled();
  });

  it("marks all orphaned jobs and projects as failed in bulk", async () => {
    jobFindMany.mockResolvedValue([
      { id: "job-1", projectId: "proj-1", project: { userId: "user-1", workspaceId: null } },
      { id: "job-2", projectId: "proj-2", project: { userId: "user-2", workspaceId: null } },
    ]);

    await reconcileOrphanedJobs();

    expect(jobUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ["job-1", "job-2"] } },
      data: { status: "failed", log: expect.stringContaining("server restart") },
    });
    expect(projectUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ["proj-1", "proj-2"] } },
      data: { status: "failed", errorMessage: expect.any(String) },
    });
  });

  // ------------------------------------------------------------------
  // REL-001: reservation-based path (new jobs with a CreditReservation)
  // ------------------------------------------------------------------

  it("uses releaseReservation (idempotent) when the job has a linked CreditReservation", async () => {
    jobFindMany.mockResolvedValue([
      { id: "job-1", projectId: "proj-1", project: { userId: "user-1", workspaceId: null } },
    ]);
    reservationFindUnique.mockResolvedValue({ id: "res-1", status: "reserved" });

    await reconcileOrphanedJobs();

    expect(mockRelease).toHaveBeenCalledWith("res-1", expect.any(String));
    expect(mockRefund).not.toHaveBeenCalled(); // fallback NOT used
  });

  it("releases the reservation using the correct message for the restart notification", async () => {
    jobFindMany.mockResolvedValue([
      { id: "job-1", projectId: "proj-1", project: { userId: "user-1", workspaceId: null } },
    ]);
    reservationFindUnique.mockResolvedValue({ id: "res-1" });

    await reconcileOrphanedJobs();

    const releaseCall = mockRelease.mock.calls[0];
    expect(releaseCall[1]).toMatch(/server restart/i);
  });

  // ------------------------------------------------------------------
  // Legacy fallback path (demo jobs, jobs created before the reservation system)
  // ------------------------------------------------------------------

  it("falls back to refundCredits when no CreditReservation is linked to the job", async () => {
    jobFindMany.mockResolvedValue([
      { id: "job-1", projectId: "proj-1", project: { userId: "user-1", workspaceId: null } },
    ]);
    reservationFindUnique.mockResolvedValue(null); // no reservation — legacy path

    await reconcileOrphanedJobs();

    expect(mockRefund).toHaveBeenCalledWith("user-1", 10);
    expect(mockRelease).not.toHaveBeenCalled();
  });

  it("legacy refund goes to workspace owner, not the member, for workspace projects", async () => {
    jobFindMany.mockResolvedValue([
      { id: "job-1", projectId: "proj-1", project: { userId: "member-id", workspaceId: "ws-1" } },
    ]);
    reservationFindUnique.mockResolvedValue(null);
    mockResolve.mockResolvedValue("owner-id");

    await reconcileOrphanedJobs();

    expect(mockResolve).toHaveBeenCalledWith({ userId: "member-id", workspaceId: "ws-1" });
    expect(mockRefund).toHaveBeenCalledWith("owner-id", 10);
    expect(mockRefund).not.toHaveBeenCalledWith("member-id", expect.any(Number));
  });

  // ------------------------------------------------------------------
  // Error isolation: one job failing must not block the others
  // ------------------------------------------------------------------

  it("continues processing remaining jobs when one release fails", async () => {
    jobFindMany.mockResolvedValue([
      { id: "job-1", projectId: "proj-1", project: { userId: "user-1", workspaceId: null } },
      { id: "job-2", projectId: "proj-2", project: { userId: "user-2", workspaceId: null } },
    ]);
    reservationFindUnique
      .mockResolvedValueOnce({ id: "res-1" })
      .mockResolvedValueOnce({ id: "res-2" });

    mockRelease
      .mockRejectedValueOnce(new Error("DB connection lost"))
      .mockResolvedValueOnce(undefined);

    await expect(reconcileOrphanedJobs()).resolves.toBeUndefined();
    expect(mockRelease).toHaveBeenCalledTimes(2);
  });

  it("continues processing when legacy refundCredits fails for one job", async () => {
    jobFindMany.mockResolvedValue([
      { id: "job-1", projectId: "proj-1", project: { userId: "user-1", workspaceId: null } },
      { id: "job-2", projectId: "proj-2", project: { userId: "user-2", workspaceId: null } },
    ]);
    reservationFindUnique.mockResolvedValue(null);

    mockRefund
      .mockRejectedValueOnce(new Error("DB connection lost"))
      .mockResolvedValueOnce(undefined);

    await expect(reconcileOrphanedJobs()).resolves.toBeUndefined();
    expect(mockRefund).toHaveBeenCalledTimes(2);
  });
});
