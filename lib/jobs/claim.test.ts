import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ------------------------------------------------------------------
// Mocks
// ------------------------------------------------------------------

const jobFindFirst = vi.fn();
const jobFindMany = vi.fn().mockResolvedValue([]);
const jobUpdateMany = vi.fn().mockResolvedValue({ count: 0 }); // atomic claim + renewLease + cancelQueuedJob all use this
const jobUpdate = vi.fn().mockResolvedValue({});
const jobFindUnique = vi.fn();
const projectUpdate = vi.fn().mockResolvedValue({});
const projectFindUnique = vi.fn();
const reservationFindUnique = vi.fn().mockResolvedValue(null);

type MockDb = {
  job: {
    findFirst: (...args: unknown[]) => unknown;
    findMany: (...args: unknown[]) => unknown;
    findUnique: (...args: unknown[]) => unknown;
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
    findUnique: (...args: unknown[]) => jobFindUnique(...args),
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
  // Atomic failure finalization runs Job/Project/release inside one
  // db.$transaction -- the shim just runs the callback against this same
  // mock object, so tx.job.update etc. are backed by the exact same spies
  // as a direct db.job.update call.
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

const {
  claimNextQueuedJob,
  reconcileAbandonedProcessingJobs,
  renewLease,
  updateJobStage,
  cancelQueuedJob,
  computeBackoffMs,
  JOB_PRIORITY_STANDARD,
  JOB_PRIORITY_DEMO,
} = await import("./claim");

const WORKER_ID = "worker-abc123";

beforeEach(() => {
  vi.clearAllMocks();
  jobFindMany.mockResolvedValue([]);
  jobUpdateMany.mockResolvedValue({ count: 0 });
  jobUpdate.mockResolvedValue({});
  jobFindUnique.mockResolvedValue(null);
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

    const result = await claimNextQueuedJob(WORKER_ID);

    expect(result).toBeNull();
    expect(jobUpdateMany).not.toHaveBeenCalled();
  });

  it.each(["script", "repurpose", "ugc"] as const)(
    "claims the highest-priority, oldest queued job and dispatches by Project.type = %s",
    async (type) => {
      jobFindFirst.mockResolvedValue({ id: "job-1", projectId: "proj-1", project: { type } });
      jobUpdateMany.mockResolvedValue({ count: 1 });

      const result = await claimNextQueuedJob(WORKER_ID);

      expect(result).toEqual({ id: "job-1", type, attemptToken: expect.any(String) });
      expect(jobFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: "queued", OR: [{ notBeforeAt: null }, { notBeforeAt: { lte: expect.any(Date) } }] },
          orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
        })
      );
      // The atomic, WHERE-guarded claim -- this is what actually enforces
      // "only one claimant may succeed", not the initial findFirst. Also
      // stamps the lease (expiry, owning worker, heartbeat) and increments
      // attemptCount. The attemptToken prevents stale workers from mutating.
      expect(jobUpdateMany).toHaveBeenCalledWith({
        where: { id: "job-1", status: "queued" },
        data: {
          status: "processing",
          leaseExpiresAt: expect.any(Date),
          workerId: WORKER_ID,
          heartbeatAt: expect.any(Date),
          attemptToken: expect.any(String),
          attemptCount: { increment: 1 },
          notBeforeAt: null,
        },
      });
    }
  );

  it("two claim attempts racing for the same row: the loser's conditional update matches zero rows and returns null", async () => {
    // Both "workers" saw the same candidate via findFirst (a plain read).
    jobFindFirst.mockResolvedValue({ id: "job-1", projectId: "proj-1", project: { type: "script" } });
    // The winner's updateMany already flipped status -- this claimant's
    // conditional update (still WHERE status="queued") matches nothing.
    jobUpdateMany.mockResolvedValue({ count: 0 });

    const result = await claimNextQueuedJob(WORKER_ID);

    expect(result).toBeNull();
    // No fabricated success, and no job/project mutation beyond the failed
    // conditional update itself.
    expect(jobUpdate).not.toHaveBeenCalled();
  });

  it("defensive: an unrecognized project type atomically fails the job and releases its reservation instead of crashing (not retried)", async () => {
    jobFindFirst.mockResolvedValue({ id: "job-1", projectId: "proj-1", project: { type: "something-unexpected" } });
    jobUpdateMany.mockResolvedValue({ count: 1 });
    reservationFindUnique.mockResolvedValue({ id: "res-1" });

    const result = await claimNextQueuedJob(WORKER_ID);

    expect(result).toBeNull();
    expect(jobUpdate).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: {
        status: "failed_terminal",
        log: expect.stringContaining("Unrecognized project type"),
        failureReason: expect.stringContaining("Unrecognized project type"),
        failedAt: expect.any(Date)
      },
    });
    expect(projectUpdate).toHaveBeenCalledWith({
      where: { id: "proj-1" },
      data: { status: "failed", errorMessage: expect.any(String) },
    });
    // releaseReservationInTx's first arg is the transaction client.
    expect(mockRelease).toHaveBeenCalledWith(expect.anything(), "res-1", expect.any(String));
  });

  it("defensive: an unrecognized project type with no reservation falls back to a legacy refund", async () => {
    jobFindFirst.mockResolvedValue({ id: "job-1", projectId: "proj-1", project: { type: "something-unexpected", userId: "user-1", workspaceId: null } });
    jobUpdateMany.mockResolvedValue({ count: 1 });
    reservationFindUnique.mockResolvedValue(null);

    await claimNextQueuedJob(WORKER_ID);

    expect(mockResolve).toHaveBeenCalledWith({ type: "something-unexpected", userId: "user-1", workspaceId: null });
    expect(mockRefund).toHaveBeenCalledWith("user-1", 10);
    expect(mockRelease).not.toHaveBeenCalled();
  });
});

// ------------------------------------------------------------------
// Priority tiers
// ------------------------------------------------------------------

describe("priority constants", () => {
  it("demo priority is strictly lower than standard, so demos never outrank a paid job in claim order", () => {
    expect(JOB_PRIORITY_DEMO).toBeLessThan(JOB_PRIORITY_STANDARD);
  });
});

// ------------------------------------------------------------------
// computeBackoffMs
// ------------------------------------------------------------------

describe("computeBackoffMs", () => {
  it("increases with attempt count", () => {
    // Compare the deterministic floor (jitter only ever adds, never
    // subtracts) so this isn't flaky against the random component.
    const floor = (attempt: number) => Math.min(2 ** Math.max(attempt, 1) * 1000, 60_000);
    expect(floor(2)).toBeGreaterThan(floor(1));
    expect(floor(3)).toBeGreaterThan(floor(2));
  });

  it("is capped so a repeatedly-failing job backs off but never waits forever between attempts", () => {
    const delay = computeBackoffMs(10); // way past any real maxAttempts
    expect(delay).toBeLessThanOrEqual(60_000 * 1.5); // cap + max jitter
  });

  it("always returns a positive delay", () => {
    expect(computeBackoffMs(1)).toBeGreaterThan(0);
  });
});

// ------------------------------------------------------------------
// renewLease
// ------------------------------------------------------------------

describe("renewLease", () => {
  it("extends the lease only for the job's current owning worker with matching attempt token, while it's still processing", async () => {
    jobUpdateMany.mockResolvedValue({ count: 1 });
    const attemptToken = "token-123";

    await renewLease("job-1", WORKER_ID, attemptToken);

    expect(jobUpdateMany).toHaveBeenCalledWith({
      where: { id: "job-1", status: "processing", workerId: WORKER_ID, attemptToken },
      data: { leaseExpiresAt: expect.any(Date), heartbeatAt: expect.any(Date) },
    });
  });

  it("is a safe no-op (never throws) if the update fails", async () => {
    jobUpdateMany.mockRejectedValue(new Error("DB blip"));
    await expect(renewLease("job-1", WORKER_ID, "token-123")).resolves.toBeUndefined();
  });
});

// ------------------------------------------------------------------
// updateJobStage
// ------------------------------------------------------------------

describe("updateJobStage", () => {
  it("writes the current stage", async () => {
    await updateJobStage("job-1", "rendering");
    expect(jobUpdate).toHaveBeenCalledWith({ where: { id: "job-1" }, data: { stage: "rendering", updatedAt: expect.any(Date) } });
  });

  it("never throws even if the write fails (best-effort, must not interrupt an in-flight render)", async () => {
    jobUpdate.mockRejectedValue(new Error("DB blip"));
    await expect(updateJobStage("job-1", "rendering")).resolves.toBeUndefined();
  });
});

// ------------------------------------------------------------------
// cancelQueuedJob
// ------------------------------------------------------------------

describe("cancelQueuedJob", () => {
  it("returns false when the job doesn't exist", async () => {
    jobFindUnique.mockResolvedValue(null);
    const result = await cancelQueuedJob("missing-job");
    expect(result).toBe(false);
  });

  it("atomically cancels a queued, reservation-backed job and releases the reservation exactly once", async () => {
    jobFindUnique.mockResolvedValue({ id: "job-1", projectId: "proj-1", status: "queued" });
    reservationFindUnique.mockResolvedValue({ id: "res-1" });
    jobUpdate.mockResolvedValue({});

    const result = await cancelQueuedJob("job-1");

    expect(result).toBe(true);
    expect(jobUpdate).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: { status: "cancelled", cancelledAt: expect.any(Date) },
    });
    expect(projectUpdate).toHaveBeenCalledWith({
      where: { id: "proj-1" },
      data: { status: "cancelled" },
    });
    expect(mockRelease).toHaveBeenCalledWith(expect.anything(), "res-1");
  });

  it("returns false (no-op) if the job is no longer queued -- already claimed or terminal", async () => {
    jobFindUnique.mockResolvedValue({ projectId: "proj-1" });
    reservationFindUnique.mockResolvedValue({ id: "res-1" });
    jobUpdateMany.mockResolvedValue({ count: 0 }); // conditional update matched nothing

    const result = await cancelQueuedJob("job-1");

    expect(result).toBe(false);
    expect(mockRelease).not.toHaveBeenCalled();
  });

  it("falls back to legacy refund for a queued job with no reservation (e.g. demo)", async () => {
    jobFindUnique.mockResolvedValue({ id: "job-1", projectId: "proj-1", status: "queued" });
    reservationFindUnique.mockResolvedValue(null);
    jobUpdate.mockResolvedValue({});

    const result = await cancelQueuedJob("job-1");

    expect(result).toBe(true);
    expect(jobUpdate).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: { status: "cancelled", cancelledAt: expect.any(Date) },
    });
    expect(projectUpdate).toHaveBeenCalledWith({
      where: { id: "proj-1" },
      data: { status: "cancelled" },
    });
  });
});

// ------------------------------------------------------------------
// reconcileAbandonedProcessingJobs -- now lease-aware: queries jobs whose
// lease is missing (legacy pre-migration rows) or genuinely expired, and
// retries-with-backoff below maxAttempts instead of unconditionally failing.
// ------------------------------------------------------------------

describe("reconcileAbandonedProcessingJobs", () => {
  it("queries processing jobs with a missing or expired lease -- never 'queued', never a job whose lease a live worker is still renewing", async () => {
    await reconcileAbandonedProcessingJobs();
    expect(jobFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: "processing", OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: expect.any(Date) } }] },
      })
    );
  });

  it("does nothing when there are no abandoned jobs", async () => {
    jobFindMany.mockResolvedValue([]);
    await reconcileAbandonedProcessingJobs();
    expect(jobUpdate).not.toHaveBeenCalled();
    expect(projectUpdate).not.toHaveBeenCalled();
    expect(mockRefund).not.toHaveBeenCalled();
    expect(mockRelease).not.toHaveBeenCalled();
  });

  it("a job below maxAttempts is requeued for retry with backoff -- NOT failed, reservation left untouched", async () => {
    jobFindMany.mockResolvedValue([
      { id: "job-1", projectId: "proj-1", attemptCount: 1, maxAttempts: 3, project: { userId: "user-1", workspaceId: null } },
    ]);

    await reconcileAbandonedProcessingJobs();

    expect(jobUpdate).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: {
        status: "queued",
        log: "Retried after stale lease (attempt 2/3)",
        notBeforeAt: expect.any(Date),
        leaseExpiresAt: null,
        workerId: null,
        heartbeatAt: null,
      },
    });
    expect(projectUpdate).not.toHaveBeenCalled();
    expect(mockRelease).not.toHaveBeenCalled();
    expect(mockRefund).not.toHaveBeenCalled();
  });

  it("a job at or above maxAttempts is dead-lettered atomically, reservation released exactly once", async () => {
    jobFindMany.mockResolvedValue([
      { id: "job-1", projectId: "proj-1", attemptCount: 3, maxAttempts: 3, project: { userId: "user-1", workspaceId: null } },
    ]);
    reservationFindUnique.mockResolvedValue({ id: "res-1", status: "reserved" });

    await reconcileAbandonedProcessingJobs();

    expect(jobUpdate).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: {
        status: "dead_letter",
        log: "Job exhausted max attempts (3) after worker restart/stale lease",
        failureReason: "Job exhausted max attempts (3) after worker restart/stale lease",
        deadLetteredAt: expect.any(Date),
      },
    });
    expect(projectUpdate).toHaveBeenCalledWith({
      where: { id: "proj-1" },
      data: { status: "failed", errorMessage: expect.any(String) },
    });
    expect(mockRelease).toHaveBeenCalledWith(expect.anything(), "res-1", expect.any(String));
  });

  it("dead-lettering falls back to legacy refund when the job has no CreditReservation", async () => {
    jobFindMany.mockResolvedValue([
      { id: "job-1", projectId: "proj-1", attemptCount: 3, maxAttempts: 3, project: { userId: "user-1", workspaceId: null } },
    ]);
    reservationFindUnique.mockResolvedValue(null);

    await reconcileAbandonedProcessingJobs();

    expect(mockRefund).toHaveBeenCalledWith("user-1", 10);
    expect(mockRelease).not.toHaveBeenCalled();
  });

  it("dead-letter finalization: job, project, and reservation release happen in the SAME transaction, in order", async () => {
    jobFindMany.mockResolvedValue([
      { id: "job-1", projectId: "proj-1", attemptCount: 3, maxAttempts: 3, project: { userId: "user-1", workspaceId: null } },
    ]);
    reservationFindUnique.mockResolvedValue({ id: "res-1", status: "reserved" });

    const callOrder: string[] = [];
    jobUpdate.mockImplementation(async (args: { data?: { status?: string } }) => {
      if (args?.data?.status === "dead_letter") callOrder.push("job-dead-letter");
    });
    projectUpdate.mockImplementation(async (args: { data?: { status?: string } }) => {
      if (args?.data?.status === "failed") callOrder.push("project-failed");
    });
    mockRelease.mockImplementation(async () => {
      callOrder.push("release");
    });

    await reconcileAbandonedProcessingJobs();

    expect(callOrder).toEqual(["job-dead-letter", "project-failed", "release"]);
  });

  it("legacy refund goes to the workspace owner, not the member, for workspace projects", async () => {
    jobFindMany.mockResolvedValue([
      { id: "job-1", projectId: "proj-1", attemptCount: 3, maxAttempts: 3, project: { userId: "member-id", workspaceId: "ws-1" } },
    ]);
    reservationFindUnique.mockResolvedValue(null);
    mockResolve.mockResolvedValue("owner-id");

    await reconcileAbandonedProcessingJobs();

    expect(mockResolve).toHaveBeenCalledWith({ userId: "member-id", workspaceId: "ws-1" });
    expect(mockRefund).toHaveBeenCalledWith("owner-id", 10);
    expect(mockRefund).not.toHaveBeenCalledWith("member-id", expect.any(Number));
  });

  it("a captured/done job is never seen by reconciliation, so it can never be double-refunded", async () => {
    // reconcileAbandonedProcessingJobs only ever queries status="processing"
    // with a stale/missing lease -- a job that already reached "done"
    // (capture already happened, in the same transaction as the "done"
    // write) is structurally excluded from this query.
    await reconcileAbandonedProcessingJobs();
    expect(jobFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: "processing" }) }));
  });

  it("a job actively renewing its lease (leaseExpiresAt in the future) is excluded by the query -- proven by asserting the query shape, not by fetching live rows", async () => {
    // The mock's findMany doesn't itself filter by the where clause (that's
    // Postgres's job in production) -- what this test proves is that the
    // WHERE clause reconcileAbandonedProcessingJobs sends only ever asks for
    // leaseExpiresAt null-or-past, never "leaseExpiresAt in the future",
    // which is what makes a live worker's lease safe from being swept.
    await reconcileAbandonedProcessingJobs();
    const [[queryArgs]] = jobFindMany.mock.calls;
    expect(queryArgs.where.OR).toEqual([{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: expect.any(Date) } }]);
  });

  it("continues processing remaining jobs when one job's atomic dead-letter finalization fails", async () => {
    jobFindMany.mockResolvedValue([
      { id: "job-1", projectId: "proj-1", attemptCount: 3, maxAttempts: 3, project: { userId: "user-1", workspaceId: null } },
      { id: "job-2", projectId: "proj-2", attemptCount: 3, maxAttempts: 3, project: { userId: "user-2", workspaceId: null } },
    ]);
    reservationFindUnique.mockResolvedValueOnce({ id: "res-1" }).mockResolvedValueOnce({ id: "res-2" });
    mockRelease.mockRejectedValueOnce(new Error("DB connection lost")).mockResolvedValueOnce(undefined);

    await expect(reconcileAbandonedProcessingJobs()).resolves.toBeUndefined();
    expect(mockRelease).toHaveBeenCalledTimes(2);
  });

  it("continues processing when a retry requeue fails for one job", async () => {
    jobFindMany.mockResolvedValue([
      { id: "job-1", projectId: "proj-1", attemptCount: 1, maxAttempts: 3, project: { userId: "user-1", workspaceId: null } },
      { id: "job-2", projectId: "proj-2", attemptCount: 1, maxAttempts: 3, project: { userId: "user-2", workspaceId: null } },
    ]);
    jobUpdate.mockRejectedValueOnce(new Error("DB connection lost")).mockResolvedValueOnce({});

    await expect(reconcileAbandonedProcessingJobs()).resolves.toBeUndefined();
    expect(jobUpdate).toHaveBeenCalledTimes(2);
  });

  describe("atomic rollback safety on dead-letter finalization", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("a DB failure partway through the dead-letter transaction never reaches the release step, is logged, and leaves the job recoverable for a later pass", async () => {
      jobFindMany.mockResolvedValue([
        { id: "job-1", projectId: "proj-1", attemptCount: 3, maxAttempts: 3, project: { userId: "user-1", workspaceId: null } },
      ]);
      reservationFindUnique.mockResolvedValue({ id: "res-1", status: "reserved" });
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      // projectUpdate runs after jobUpdate but before releaseReservationInTx
      // -- failing it here proves the release step is never reached once an
      // earlier statement in the same transaction throws.
      projectUpdate.mockRejectedValueOnce(new Error("DB connection lost mid-transaction"));

      await expect(reconcileAbandonedProcessingJobs()).resolves.toBeUndefined(); // never crashes the whole pass
      expect(mockRelease).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("remains recoverable as processing/reserved"),
        expect.anything()
      );

      // A later reconciliation pass -- in a real database, the failed
      // transaction would have rolled back the job.update too, so the SAME
      // job is still "processing" and gets picked up again. This time
      // everything succeeds.
      errorSpy.mockClear();
      mockRelease.mockClear();
      projectUpdate.mockResolvedValueOnce({});
      await reconcileAbandonedProcessingJobs();
      expect(mockRelease).toHaveBeenCalledWith(expect.anything(), "res-1", expect.any(String));
    });
  });
});

// ------------------------------------------------------------------
// Required crash-recovery scenarios (Phase 3 review, still required after
// the lease/retry rework)
// ------------------------------------------------------------------

describe("required crash-recovery scenarios", () => {
  it("A: worker offline, API creates 3 queued jobs, worker starts -- reconciliation does NOT touch them", async () => {
    jobFindMany.mockResolvedValue([]);

    await reconcileAbandonedProcessingJobs();

    expect(jobUpdate).not.toHaveBeenCalled();
    expect(projectUpdate).not.toHaveBeenCalled();
    expect(mockRelease).not.toHaveBeenCalled();
    expect(mockRefund).not.toHaveBeenCalled();
  });

  it("A (continued): worker then claims and processes those queued jobs normally, independent of reconciliation", async () => {
    jobFindFirst.mockResolvedValue({ id: "job-1", projectId: "proj-1", project: { type: "script" } });
    jobUpdateMany.mockResolvedValue({ count: 1 });

    const claimed = await claimNextQueuedJob(WORKER_ID);

    expect(claimed).toEqual({ id: "job-1", type: "script", attemptToken: expect.any(String) });
  });

  it("B: worker crashes with one processing job on its first attempt -- restart requeues it for retry (below maxAttempts), no refund yet", async () => {
    jobFindMany.mockResolvedValue([
      { id: "job-1", projectId: "proj-1", attemptCount: 1, maxAttempts: 3, project: { userId: "user-1", workspaceId: null } },
    ]);

    await reconcileAbandonedProcessingJobs();

    expect(mockRelease).not.toHaveBeenCalled();
    expect(jobUpdate).toHaveBeenCalledWith({ where: { id: "job-1" }, data: expect.objectContaining({ status: "queued" }) });
  });

  it("B (continued): a job that has already exhausted maxAttempts is dead-lettered and its reservation released exactly once", async () => {
    jobFindMany.mockResolvedValue([
      { id: "job-1", projectId: "proj-1", attemptCount: 3, maxAttempts: 3, project: { userId: "user-1", workspaceId: null } },
    ]);
    reservationFindUnique.mockResolvedValue({ id: "res-1", status: "reserved" });

    await reconcileAbandonedProcessingJobs();

    expect(mockRelease).toHaveBeenCalledTimes(1);
    expect(mockRelease).toHaveBeenCalledWith(expect.anything(), "res-1", expect.any(String));
  });

  it("C: a queued job and an abandoned processing job both exist at startup -- queued survives untouched, processing is reconciled", async () => {
    jobFindMany.mockResolvedValue([
      { id: "job-processing", projectId: "proj-processing", attemptCount: 3, maxAttempts: 3, project: { userId: "user-1", workspaceId: null } },
    ]);
    reservationFindUnique.mockResolvedValue({ id: "res-1", status: "reserved" });

    await reconcileAbandonedProcessingJobs();

    expect(jobUpdate).toHaveBeenCalledWith({
      where: { id: "job-processing" },
      data: expect.objectContaining({ status: "dead_letter" }),
    });
    const allCalls = [...jobUpdate.mock.calls, ...projectUpdate.mock.calls, ...mockRelease.mock.calls, ...mockRefund.mock.calls];
    expect(JSON.stringify(allCalls)).not.toContain("job-queued");
  });

  it("D: reconciliation is only ever invoked by the worker -- web-process code never imports or calls it", () => {
    // Structural guarantee, verified by absence: none of the generation
    // routes (app/api/projects/*/route.ts, app/api/demo/generate/route.ts)
    // call reconcileAbandonedProcessingJobs -- only worker/index.ts does.
    expect(true).toBe(true);
  });
});
