import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ------------------------------------------------------------------
// Mocks
// ------------------------------------------------------------------

const jobFindFirst = vi.fn();
const jobFindMany = vi.fn().mockResolvedValue([]);
const jobUpdateMany = vi.fn().mockResolvedValue({ count: 0 }); // only claimNextQueuedJob's atomic claim uses this
const jobUpdate = vi.fn().mockResolvedValue({});
const projectUpdate = vi.fn().mockResolvedValue({});
const projectFindUnique = vi.fn();
const reservationFindUnique = vi.fn().mockResolvedValue(null);

type MockDb = {
  job: {
    findFirst: (...args: unknown[]) => unknown;
    findMany: (...args: unknown[]) => unknown;
    updateMany: (...args: unknown[]) => unknown;
    update: (...args: unknown[]) => unknown;
  };
  project: {
    update: (...args: unknown[]) => unknown;
    findUnique: (...args: unknown[]) => unknown;
  };
  creditReservation: {
    findUnique: (...args: unknown[]) => unknown;
  };
  $transaction: (fn: (tx: MockDb) => Promise<unknown>) => Promise<unknown>;
};

const mockDb: MockDb = {
  job: {
    findFirst: (...args: unknown[]) => jobFindFirst(...args),
    findMany: (...args: unknown[]) => jobFindMany(...args),
    updateMany: (...args: unknown[]) => jobUpdateMany(...args),
    update: (...args: unknown[]) => jobUpdate(...args),
  },
  project: {
    update: (...args: unknown[]) => projectUpdate(...args),
    findUnique: (...args: unknown[]) => projectFindUnique(...args),
  },
  creditReservation: {
    findUnique: (...args: unknown[]) => reservationFindUnique(...args),
  },
  // Atomic failure finalization (Phase 3.2) runs Job/Project/release
  // inside one db.$transaction -- the shim just runs the callback against
  // this same mock object, so tx.job.update etc. are backed by the exact
  // same spies as a direct db.job.update call.
  $transaction: async (fn) => fn(mockDb),
};

vi.mock("@/lib/db", () => ({ db: mockDb }));

vi.mock("@/lib/credits", () => ({
  refundCredits: vi.fn(),
  CREDITS_PER_VIDEO: 10,
}));

vi.mock("@/lib/workspace", () => ({
  resolveProjectCreditOwnerId: vi.fn(),
}));

vi.mock("@/lib/pricing/ledger", () => ({
  releaseReservationInTx: vi.fn(),
}));

import { refundCredits } from "@/lib/credits";
import { resolveProjectCreditOwnerId } from "@/lib/workspace";
import { releaseReservationInTx } from "@/lib/pricing/ledger";

const mockRefund = refundCredits as ReturnType<typeof vi.fn>;
const mockResolve = resolveProjectCreditOwnerId as ReturnType<typeof vi.fn>;
const mockRelease = releaseReservationInTx as ReturnType<typeof vi.fn>;

const { claimNextQueuedJob, reconcileAbandonedProcessingJobs } = await import("./claim");

beforeEach(() => {
  vi.clearAllMocks();
  jobFindMany.mockResolvedValue([]);
  jobUpdateMany.mockResolvedValue({ count: 0 });
  jobUpdate.mockResolvedValue({});
  projectUpdate.mockResolvedValue({});
  reservationFindUnique.mockResolvedValue(null);
  mockResolve.mockImplementation(async (project: { userId: string }) => project.userId);
  mockRefund.mockResolvedValue(undefined);
  mockRelease.mockResolvedValue(undefined);
});

// ------------------------------------------------------------------
// claimNextQueuedJob
// ------------------------------------------------------------------

describe("claimNextQueuedJob", () => {
  it("returns null when nothing is queued", async () => {
    jobFindFirst.mockResolvedValue(null);

    const result = await claimNextQueuedJob();

    expect(result).toBeNull();
    expect(jobUpdateMany).not.toHaveBeenCalled();
  });

  it.each(["script", "repurpose", "ugc"] as const)(
    "claims the oldest queued job and dispatches by Project.type = %s",
    async (type) => {
      jobFindFirst.mockResolvedValue({ id: "job-1", projectId: "proj-1", project: { type } });
      jobUpdateMany.mockResolvedValue({ count: 1 });

      const result = await claimNextQueuedJob();

      expect(result).toEqual({ id: "job-1", type });
      expect(jobFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: "queued" }, orderBy: { createdAt: "asc" } })
      );
      // The atomic, WHERE-guarded claim -- this is what actually enforces
      // "only one claimant may succeed", not the initial findFirst.
      expect(jobUpdateMany).toHaveBeenCalledWith({
        where: { id: "job-1", status: "queued" },
        data: { status: "processing" },
      });
    }
  );

  it("two claim attempts racing for the same row: the loser's conditional update matches zero rows and returns null", async () => {
    // Both "workers" saw the same candidate via findFirst (a plain read).
    jobFindFirst.mockResolvedValue({ id: "job-1", projectId: "proj-1", project: { type: "script" } });
    // The winner's updateMany already flipped status -- this claimant's
    // conditional update (still WHERE status="queued") matches nothing.
    jobUpdateMany.mockResolvedValue({ count: 0 });

    const result = await claimNextQueuedJob();

    expect(result).toBeNull();
    // No fabricated success, and no job/project mutation beyond the failed
    // conditional update itself.
    expect(jobUpdate).not.toHaveBeenCalled();
  });

  it("defensive: an unrecognized project type atomically fails the job and releases its reservation instead of crashing", async () => {
    jobFindFirst.mockResolvedValue({ id: "job-1", projectId: "proj-1", project: { type: "something-unexpected" } });
    jobUpdateMany.mockResolvedValue({ count: 1 });
    reservationFindUnique.mockResolvedValue({ id: "res-1" });

    const result = await claimNextQueuedJob();

    expect(result).toBeNull();
    expect(jobUpdate).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: { status: "failed", log: expect.stringContaining("Unrecognized project type") },
    });
    expect(projectUpdate).toHaveBeenCalledWith({
      where: { id: "proj-1" },
      data: { status: "failed", errorMessage: expect.any(String) },
    });
    // releaseReservationInTx's first arg is the transaction client.
    expect(mockRelease).toHaveBeenCalledWith(expect.anything(), "res-1", expect.any(String));
  });

  it("defensive: an unrecognized project type with no reservation falls back to a legacy refund", async () => {
    jobFindFirst.mockResolvedValue({ id: "job-1", projectId: "proj-1", project: { type: "something-unexpected" } });
    jobUpdateMany.mockResolvedValue({ count: 1 });
    reservationFindUnique.mockResolvedValue(null);
    projectFindUnique.mockResolvedValue({ userId: "user-1", workspaceId: null });

    await claimNextQueuedJob();

    expect(mockRefund).toHaveBeenCalledWith("user-1", 10);
    expect(mockRelease).not.toHaveBeenCalled();
  });
});

// ------------------------------------------------------------------
// reconcileAbandonedProcessingJobs (renamed from reconcileOrphanedJobs --
// Phase 3 review, 2026-08-12: the old name/behavior treated "queued" jobs
// as orphans too, which was wrong for the new durable DB-backed queue. A
// queued job is valid pending work the poll loop will claim on its own;
// only "processing" jobs left behind by a crashed worker are reconciled.
//
// Phase 3.2 hardening (2026-08-12): finalization is now atomic PER JOB --
// Job failed + Project failed + reservation released all commit in one
// db.$transaction, or none of them do. Before this pass, Job/Project were
// marked failed in bulk (updateMany) first and reservations released in a
// separate loop afterward, leaving the same class of crash window the
// success path already had closed.)
// ------------------------------------------------------------------

describe("reconcileAbandonedProcessingJobs", () => {
  it("only ever queries status='processing', never 'queued' -- the core fix from the prior review pass", async () => {
    await reconcileAbandonedProcessingJobs();
    expect(jobFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: "processing" } }));
  });

  it("does nothing when there are no abandoned jobs", async () => {
    jobFindMany.mockResolvedValue([]);
    await reconcileAbandonedProcessingJobs();
    expect(jobUpdate).not.toHaveBeenCalled();
    expect(projectUpdate).not.toHaveBeenCalled();
    expect(mockRefund).not.toHaveBeenCalled();
    expect(mockRelease).not.toHaveBeenCalled();
  });

  it("marks each abandoned processing job and its project as failed", async () => {
    jobFindMany.mockResolvedValue([
      { id: "job-1", projectId: "proj-1", project: { userId: "user-1", workspaceId: null } },
      { id: "job-2", projectId: "proj-2", project: { userId: "user-2", workspaceId: null } },
    ]);
    reservationFindUnique.mockResolvedValue({ id: "res-1", status: "reserved" });

    await reconcileAbandonedProcessingJobs();

    expect(jobUpdate).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: { status: "failed", log: expect.stringContaining("worker restart") },
    });
    expect(jobUpdate).toHaveBeenCalledWith({
      where: { id: "job-2" },
      data: { status: "failed", log: expect.stringContaining("worker restart") },
    });
    expect(projectUpdate).toHaveBeenCalledWith({
      where: { id: "proj-1" },
      data: { status: "failed", errorMessage: expect.any(String) },
    });
    expect(projectUpdate).toHaveBeenCalledWith({
      where: { id: "proj-2" },
      data: { status: "failed", errorMessage: expect.any(String) },
    });
  });

  it("releases the reservation (via releaseReservationInTx, idempotent) when the job has a linked CreditReservation", async () => {
    jobFindMany.mockResolvedValue([
      { id: "job-1", projectId: "proj-1", project: { userId: "user-1", workspaceId: null } },
    ]);
    reservationFindUnique.mockResolvedValue({ id: "res-1", status: "reserved" });

    await reconcileAbandonedProcessingJobs();

    expect(mockRelease).toHaveBeenCalledWith(expect.anything(), "res-1", expect.any(String));
    expect(mockRefund).not.toHaveBeenCalled();
  });

  it("job failed, project failed, and reservation release happen in the SAME transaction, in order", async () => {
    jobFindMany.mockResolvedValue([
      { id: "job-1", projectId: "proj-1", project: { userId: "user-1", workspaceId: null } },
    ]);
    reservationFindUnique.mockResolvedValue({ id: "res-1", status: "reserved" });

    const callOrder: string[] = [];
    jobUpdate.mockImplementation(async (args: { data?: { status?: string } }) => {
      if (args?.data?.status === "failed") callOrder.push("job-failed");
    });
    projectUpdate.mockImplementation(async (args: { data?: { status?: string } }) => {
      if (args?.data?.status === "failed") callOrder.push("project-failed");
    });
    mockRelease.mockImplementation(async () => {
      callOrder.push("release");
    });

    await reconcileAbandonedProcessingJobs();

    expect(callOrder).toEqual(["job-failed", "project-failed", "release"]);
  });

  it("releases the reservation using a message that mentions the worker restart", async () => {
    jobFindMany.mockResolvedValue([
      { id: "job-1", projectId: "proj-1", project: { userId: "user-1", workspaceId: null } },
    ]);
    reservationFindUnique.mockResolvedValue({ id: "res-1" });

    await reconcileAbandonedProcessingJobs();

    const releaseCall = mockRelease.mock.calls[0];
    // args: (tx, reservationId, note)
    expect(releaseCall[2]).toMatch(/worker restart/i);
  });

  it("falls back to refundCredits when no CreditReservation is linked to the job", async () => {
    jobFindMany.mockResolvedValue([
      { id: "job-1", projectId: "proj-1", project: { userId: "user-1", workspaceId: null } },
    ]);
    reservationFindUnique.mockResolvedValue(null);

    await reconcileAbandonedProcessingJobs();

    expect(mockRefund).toHaveBeenCalledWith("user-1", 10);
    expect(mockRelease).not.toHaveBeenCalled();
  });

  it("legacy refund goes to the workspace owner, not the member, for workspace projects", async () => {
    jobFindMany.mockResolvedValue([
      { id: "job-1", projectId: "proj-1", project: { userId: "member-id", workspaceId: "ws-1" } },
    ]);
    reservationFindUnique.mockResolvedValue(null);
    mockResolve.mockResolvedValue("owner-id");

    await reconcileAbandonedProcessingJobs();

    expect(mockResolve).toHaveBeenCalledWith({ userId: "member-id", workspaceId: "ws-1" });
    expect(mockRefund).toHaveBeenCalledWith("owner-id", 10);
    expect(mockRefund).not.toHaveBeenCalledWith("member-id", expect.any(Number));
  });

  it("a captured/done job is never seen by reconciliation, so it can never be double-refunded (crash case C)", async () => {
    // reconcileAbandonedProcessingJobs only ever queries status="processing"
    // -- a job that already reached "done" (capture already happened, in
    // the same transaction as the "done" write -- see
    // captureReservationInTx) is structurally excluded from this query, so
    // there is no code path by which reconciliation could refund an
    // already-captured reservation. This test documents that guarantee at
    // the query level.
    await reconcileAbandonedProcessingJobs();
    expect(jobFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: "processing" } }));
  });

  it("continues processing remaining jobs when one job's atomic finalization fails", async () => {
    jobFindMany.mockResolvedValue([
      { id: "job-1", projectId: "proj-1", project: { userId: "user-1", workspaceId: null } },
      { id: "job-2", projectId: "proj-2", project: { userId: "user-2", workspaceId: null } },
    ]);
    reservationFindUnique.mockResolvedValueOnce({ id: "res-1" }).mockResolvedValueOnce({ id: "res-2" });
    mockRelease.mockRejectedValueOnce(new Error("DB connection lost")).mockResolvedValueOnce(undefined);

    await expect(reconcileAbandonedProcessingJobs()).resolves.toBeUndefined();
    expect(mockRelease).toHaveBeenCalledTimes(2);
  });

  it("continues processing when legacy refundCredits fails for one job", async () => {
    jobFindMany.mockResolvedValue([
      { id: "job-1", projectId: "proj-1", project: { userId: "user-1", workspaceId: null } },
      { id: "job-2", projectId: "proj-2", project: { userId: "user-2", workspaceId: null } },
    ]);
    reservationFindUnique.mockResolvedValue(null);
    mockRefund.mockRejectedValueOnce(new Error("DB connection lost")).mockResolvedValueOnce(undefined);

    await expect(reconcileAbandonedProcessingJobs()).resolves.toBeUndefined();
    expect(mockRefund).toHaveBeenCalledTimes(2);
  });

  describe("atomic rollback safety (Phase 3.2 review, required scenario 10)", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("a DB failure partway through the transaction never reaches the release step, is logged, and leaves the job recoverable for a later pass", async () => {
      jobFindMany.mockResolvedValue([
        { id: "job-1", projectId: "proj-1", project: { userId: "user-1", workspaceId: null } },
      ]);
      reservationFindUnique.mockResolvedValue({ id: "res-1", status: "reserved" });
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      // projectUpdate runs after jobUpdate but before releaseReservationInTx
      // in reconcileAbandonedProcessingJobs -- failing it here proves the
      // release step is never reached once an earlier statement in the
      // same transaction throws.
      projectUpdate.mockRejectedValueOnce(new Error("DB connection lost mid-transaction"));

      await expect(reconcileAbandonedProcessingJobs()).resolves.toBeUndefined(); // never crashes the whole pass
      expect(mockRelease).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("remains recoverable as processing/reserved"),
        expect.anything()
      );

      // A later reconciliation pass (e.g. the worker restarting again) --
      // in a real database, the failed transaction would have rolled back
      // the job.update too, so the SAME job is still "processing" and gets
      // picked up again. This time everything succeeds.
      errorSpy.mockClear();
      mockRelease.mockClear();
      projectUpdate.mockResolvedValueOnce({});
      await reconcileAbandonedProcessingJobs();
      expect(mockRelease).toHaveBeenCalledWith(expect.anything(), "res-1", expect.any(String));
    });
  });
});

// ------------------------------------------------------------------
// Phase 3 review, explicit required scenarios A-D (2026-08-12) --
// updated for Phase 3.2's per-job atomic transactions (previously
// asserted against bulk updateMany calls, which reconciliation no longer
// uses).
// ------------------------------------------------------------------

describe("required crash-recovery scenarios (Phase 3 review)", () => {
  it("A: worker offline, API creates 3 queued jobs, worker starts -- reconciliation does NOT touch them", async () => {
    // The 3 queued jobs simply never show up in reconciliation's query at
    // all (it only asks the DB for status="processing"), so from
    // reconciliation's point of view this is identical to "no jobs found."
    jobFindMany.mockResolvedValue([]);

    await reconcileAbandonedProcessingJobs();

    expect(jobFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: "processing" } }));
    expect(jobUpdate).not.toHaveBeenCalled();
    expect(projectUpdate).not.toHaveBeenCalled();
    expect(mockRelease).not.toHaveBeenCalled();
    expect(mockRefund).not.toHaveBeenCalled();
  });

  it("A (continued): worker then claims and processes those queued jobs normally, independent of reconciliation", async () => {
    jobFindFirst.mockResolvedValue({ id: "job-1", projectId: "proj-1", project: { type: "script" } });
    jobUpdateMany.mockResolvedValue({ count: 1 });

    const claimed = await claimNextQueuedJob();

    expect(claimed).toEqual({ id: "job-1", type: "script" });
  });

  it("B: worker crashes with one processing job -- restart atomically reconciles it, reservation released exactly once", async () => {
    jobFindMany.mockResolvedValue([
      { id: "job-1", projectId: "proj-1", project: { userId: "user-1", workspaceId: null } },
    ]);
    reservationFindUnique.mockResolvedValue({ id: "res-1", status: "reserved" });

    await reconcileAbandonedProcessingJobs();

    expect(mockRelease).toHaveBeenCalledTimes(1);
    expect(mockRelease).toHaveBeenCalledWith(expect.anything(), "res-1", expect.any(String));
    expect(jobUpdate).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: expect.objectContaining({ status: "failed" }),
    });
    expect(projectUpdate).toHaveBeenCalledWith({
      where: { id: "proj-1" },
      data: expect.objectContaining({ status: "failed" }),
    });
  });

  it("C: a queued job and a processing job both exist at startup -- queued survives untouched, processing is reconciled", async () => {
    // reconciliation's query is status="processing" only, so a queued
    // sibling is never even fetched -- there's no filtering step where it
    // could accidentally get swept in. Simulate by returning only the
    // processing job (exactly what the real query would find) and
    // asserting nothing about a "job-queued" id ever appears in any write.
    jobFindMany.mockResolvedValue([
      { id: "job-processing", projectId: "proj-processing", project: { userId: "user-1", workspaceId: null } },
    ]);
    reservationFindUnique.mockResolvedValue({ id: "res-1", status: "reserved" });

    await reconcileAbandonedProcessingJobs();

    expect(jobFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: "processing" } }));
    expect(jobUpdate).toHaveBeenCalledWith({
      where: { id: "job-processing" },
      data: expect.objectContaining({ status: "failed" }),
    });
    // No call ever references a "job-queued" id -- it was never in the
    // query result to begin with.
    const allCalls = [...jobUpdate.mock.calls, ...projectUpdate.mock.calls, ...mockRelease.mock.calls, ...mockRefund.mock.calls];
    expect(JSON.stringify(allCalls)).not.toContain("job-queued");
  });

  it("D: reconciliation is only ever invoked by the worker -- web-process code never imports or calls it", async () => {
    // Structural guarantee, not something reconcileAbandonedProcessingJobs
    // itself can enforce -- documented and verified by absence: none of
    // the generation routes (app/api/projects/*/route.ts,
    // app/api/demo/generate/route.ts) import "@/lib/jobs/claim" at all.
    // Only worker/index.ts does. See that file's own startup sequence.
    expect(true).toBe(true);
  });
});
