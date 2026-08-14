import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// worker/index.ts statically imports @/lib/db, @/lib/jobs/claim, @/lib/workers/admission,
// and the three runners -- stub all of them so importing the module here never
// touches a real DB connection or pulls in the Remotion/TensorFlow
// dependency tree. The tests below construct their own `Worker` instances
// with injected `claim`/`runners`/`onLog`, so these mocks only need to
// exist, not do anything meaningful.
vi.mock("@/lib/db", () => ({ db: { $queryRaw: vi.fn() } }));
vi.mock("@/lib/jobs/claim", () => ({
  claimNextQueuedJob: vi.fn(),
  reconcileAbandonedProcessingJobs: vi.fn(),
  renewLease: vi.fn(),
  LEASE_DURATION_MS: 45_000,
}));
vi.mock("@/lib/workers/admission", () => ({
  requestAdmission: vi.fn(),
  renewAdmissionHeartbeat: vi.fn(),
  retireRegistration: vi.fn(),
  MAX_ACTIVE_WORKERS: 1,
  ADMISSION_CHECK_INTERVAL_MS: 10_000,
}));
vi.mock("@/lib/jobs/script-runner", () => ({ runScriptJob: vi.fn() }));
vi.mock("@/lib/jobs/repurpose-runner", () => ({ runRepurposeJob: vi.fn() }));
vi.mock("@/lib/jobs/ugc-runner", () => ({ runUgcJob: vi.fn() }));

const { Worker, readWorkerConfigFromEnv } = await import("./index");

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("readWorkerConfigFromEnv", () => {
  const originalEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("defaults WORKER_CONCURRENCY to 1 (not 2) -- worker isolation must not just relocate the existing OOM risk", () => {
    delete process.env.WORKER_CONCURRENCY;
    delete process.env.WORKER_POLL_INTERVAL_MS;
    expect(readWorkerConfigFromEnv()).toEqual({ concurrency: 1, pollIntervalMs: 3000 });
  });

  it("reads WORKER_CONCURRENCY and WORKER_POLL_INTERVAL_MS from the environment", () => {
    process.env.WORKER_CONCURRENCY = "2";
    process.env.WORKER_POLL_INTERVAL_MS = "5000";
    expect(readWorkerConfigFromEnv()).toEqual({ concurrency: 2, pollIntervalMs: 5000 });
  });

  it("falls back to safe defaults for invalid/non-positive values instead of crashing", () => {
    process.env.WORKER_CONCURRENCY = "not-a-number";
    process.env.WORKER_POLL_INTERVAL_MS = "-500";
    expect(readWorkerConfigFromEnv()).toEqual({ concurrency: 1, pollIntervalMs: 3000 });
  });
});

describe("Worker", () => {
  let logs: string[];
  const onLog = (line: string) => logs.push(line);

  beforeEach(() => {
    logs = [];
  });

  describe("dispatch by claimed type", () => {
    it.each(["script", "repurpose", "ugc"] as const)("routes a claimed %s job to the matching runner", async (type) => {
      const runner = vi.fn().mockResolvedValue(undefined);
      const otherType = type === "script" ? "repurpose" : "script";
      const otherRunner = vi.fn().mockResolvedValue(undefined);
      const attemptToken = "token-123";
      const claim = vi
        .fn()
        .mockResolvedValueOnce({ id: "job-1", type, attemptToken })
        .mockResolvedValue(null);

      const worker = new Worker({
        concurrency: 1,
        pollIntervalMs: 60_000,
        claim,
        runners: { [type]: runner, [otherType]: otherRunner } as never,
        onLog,
        skipAdmission: true,
      });

      await worker.tick();
      await Promise.resolve(); // let the runner's .then/.finally microtasks settle

      expect(runner).toHaveBeenCalledWith("job-1", worker.instanceId, attemptToken);
      expect(otherRunner).not.toHaveBeenCalled();
    });
  });

  describe("concurrency", () => {
    it("never has more in-flight jobs than the configured concurrency", async () => {
      const pending: Array<{ resolve: () => void }> = [];
      const runner = vi.fn().mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            pending.push({ resolve });
          })
      );
      // Exactly 2 "available" candidates -- enough to prove the while loop
      // in tick() stops at the concurrency limit even though there'd be
      // more to claim, without also having to model an unbounded backlog:
      // once both jobs are in flight, tick()'s own demand-driven re-poll
      // (fired from each job's .finally()) will call claim() again, and it
      // must see nothing left.
      let claimCount = 0;
      const claim = vi.fn().mockImplementation(async () => {
        claimCount++;
        return claimCount <= 2 ? { id: `job-${claimCount}`, type: "script" as const, attemptToken: `token-${claimCount}` } : null;
      });

      const worker = new Worker({
        concurrency: 2,
        pollIntervalMs: 60_000,
        claim,
        runners: { script: runner, repurpose: runner, ugc: runner },
        onLog,
        skipAdmission: true,
      });

      await worker.tick();

      // Only 2 jobs should have been claimed and started -- the while loop
      // in tick() stops once `active` reaches the concurrency limit, even
      // though claim() has more "queued" work available (claimCount would
      // keep incrementing past 2 if tick() kept calling it).
      expect(worker.activeCount).toBe(2);
      expect(runner).toHaveBeenCalledTimes(2);

      pending.forEach((p) => p.resolve());
      // Each completed job's .then/.catch/.finally chain, plus the
      // demand-driven re-tick() it triggers (itself awaiting an async
      // claim() call), is several microtask hops deep -- a macrotask
      // boundary reliably flushes all of them rather than guessing an
      // exact count of Promise.resolve() hops.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(worker.activeCount).toBe(0);
    });

    it("defaults to WORKER_CONCURRENCY=1 semantics when constructed with concurrency:1 -- claims exactly one job before stopping", async () => {
      const claim = vi.fn().mockResolvedValueOnce({ id: "job-1", type: "script" as const, attemptToken: "token-1" }).mockResolvedValue(null);
      const runner = vi.fn().mockImplementation(() => new Promise<void>(() => {})); // never resolves during this test

      const worker = new Worker({ concurrency: 1, pollIntervalMs: 60_000, claim, runners: { script: runner, repurpose: runner, ugc: runner }, onLog, skipAdmission: true });

      await worker.tick();

      expect(worker.activeCount).toBe(1);
      expect(claim).toHaveBeenCalledTimes(1); // stopped claiming once the single slot was full
    });
  });

  describe("error isolation (one bad job cannot kill the worker or block others)", () => {
    it("a runner that throws does not crash tick() or prevent subsequent jobs from being claimed and run", async () => {
      const failing = vi.fn().mockRejectedValue(new Error("boom"));
      const succeeding = vi.fn().mockResolvedValue(undefined);
      const claim = vi
        .fn()
        .mockResolvedValueOnce({ id: "job-fail", type: "script" as const, attemptToken: "token-fail" })
        .mockResolvedValueOnce(null);

      const worker = new Worker({
        concurrency: 1,
        pollIntervalMs: 60_000,
        claim,
        runners: { script: failing, repurpose: succeeding, ugc: succeeding },
        onLog,
        skipAdmission: true,
      });

      await expect(worker.tick()).resolves.toBeUndefined(); // never throws out of tick()
      await Promise.resolve();
      await Promise.resolve();

      expect(worker.activeCount).toBe(0); // the failed job's slot was freed, not stuck
      expect(logs.some((l) => l.includes("job failed unexpectedly") && l.includes("job-fail"))).toBe(true);

      // A subsequent poll can claim and run a different job normally --
      // the worker process itself is still alive and functional.
      claim.mockResolvedValueOnce({ id: "job-ok", type: "repurpose" as const, attemptToken: "token-ok" }).mockResolvedValue(null);
      await worker.tick();
      await Promise.resolve();

      expect(succeeding).toHaveBeenCalledWith("job-ok", worker.instanceId, "token-ok");
    });
  });

  describe("shutdown", () => {
    it("stops claiming new jobs immediately once shutdown starts", async () => {
      const claim = vi.fn().mockResolvedValue(null);
      const worker = new Worker({ concurrency: 2, pollIntervalMs: 60_000, claim, onLog });

      await worker.shutdown("SIGTERM");
      claim.mockClear();

      await worker.tick(); // should be a no-op post-shutdown
      expect(claim).not.toHaveBeenCalled();
    });

    it("waits for in-flight jobs to finish before resolving, and logs the drain", async () => {
      const { promise: runnerPromise, resolve: finishRunner } = deferred<void>();
      const runner = vi.fn().mockReturnValue(runnerPromise);
      const claim = vi.fn().mockResolvedValueOnce({ id: "job-1", type: "script" as const }).mockResolvedValue(null);

      const worker = new Worker({
        concurrency: 1,
        pollIntervalMs: 60_000,
        claim,
        runners: { script: runner, repurpose: runner, ugc: runner },
        onLog,
        skipAdmission: true,
      });

      await worker.tick(); // claims and "starts" job-1 (never resolves until we say so)
      expect(worker.activeCount).toBe(1);

      let shutdownResolved = false;
      const shutdownPromise = worker.shutdown("SIGTERM").then(() => {
        shutdownResolved = true;
      });

      // Shutdown must not resolve while job-1 is still in flight.
      await Promise.resolve();
      await Promise.resolve();
      expect(shutdownResolved).toBe(false);
      expect(logs.some((l) => l.includes("SIGTERM") && l.includes("draining 1 in-flight"))).toBe(true);

      finishRunner();
      await shutdownPromise;
      expect(shutdownResolved).toBe(true);
      expect(logs.some((l) => l.includes("shutdown complete"))).toBe(true);
    });

    it("a second shutdown call is a no-op (idempotent)", async () => {
      const worker = new Worker({ concurrency: 1, pollIntervalMs: 60_000, claim: vi.fn().mockResolvedValue(null), onLog });
      await worker.shutdown("SIGTERM");
      const logCountAfterFirst = logs.length;
      await worker.shutdown("SIGINT");
      expect(logs.length).toBe(logCountAfterFirst); // no duplicate drain/complete logs
    });
  });

  describe("polling loop (start/stop with fake timers)", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("polls again after pollIntervalMs and claims newly-queued work", async () => {
      const claim = vi.fn().mockResolvedValue(null);
      const worker = new Worker({ concurrency: 1, pollIntervalMs: 1000, claim, onLog, skipAdmission: true });

      worker.start();
      await vi.advanceTimersByTimeAsync(0); // the immediate first tick() inside start()
      expect(claim).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1000);
      expect(claim).toHaveBeenCalledTimes(2);

      await worker.shutdown("SIGTERM");
      await vi.advanceTimersByTimeAsync(5000);
      expect(claim).toHaveBeenCalledTimes(2); // no more polling after shutdown
    });
  });

  describe("lease heartbeat renewal (in-flight jobs keep their lease alive)", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("renews the lease periodically while a job is in flight", async () => {
      const attemptToken = "test-token-123";
      const claim = vi.fn().mockResolvedValueOnce({ id: "job-1", type: "script" as const, attemptToken }).mockResolvedValue(null);
      const runner = vi.fn().mockReturnValue(new Promise<void>(() => {})); // never resolves during this test
      const renewLeaseFn = vi.fn().mockResolvedValue(undefined);

      const worker = new Worker({
        concurrency: 1,
        pollIntervalMs: 60_000,
        claim,
        renewLease: renewLeaseFn,
        runners: { script: runner, repurpose: runner, ugc: runner },
        onLog,
        skipAdmission: true,
      });

      await worker.tick();
      expect(renewLeaseFn).not.toHaveBeenCalled(); // not yet -- only after the first heartbeat interval elapses

      // Heartbeat interval is LEASE_DURATION_MS / 3 = 15_000ms here.
      await vi.advanceTimersByTimeAsync(15_000);
      expect(renewLeaseFn).toHaveBeenCalledWith("job-1", worker.instanceId, attemptToken);

      await vi.advanceTimersByTimeAsync(15_000);
      expect(renewLeaseFn).toHaveBeenCalledTimes(2);
    });

    it("stops renewing once the job completes -- no leaked interval", async () => {
      const { promise: runnerPromise, resolve: finishRunner } = deferred<void>();
      const attemptToken = "test-token-456";
      const claim = vi.fn().mockResolvedValueOnce({ id: "job-1", type: "script" as const, attemptToken }).mockResolvedValue(null);
      const runner = vi.fn().mockReturnValue(runnerPromise);
      const renewLeaseFn = vi.fn().mockResolvedValue(undefined);

      const worker = new Worker({
        concurrency: 1,
        pollIntervalMs: 60_000,
        claim,
        renewLease: renewLeaseFn,
        runners: { script: runner, repurpose: runner, ugc: runner },
        onLog,
        skipAdmission: true,
      });

      await worker.tick();
      finishRunner();
      await vi.advanceTimersByTimeAsync(0); // let the .finally() clear the heartbeat interval

      renewLeaseFn.mockClear();
      await vi.advanceTimersByTimeAsync(60_000); // well past several heartbeat intervals
      expect(renewLeaseFn).not.toHaveBeenCalled();
    });
  });

  describe("periodic reconciliation (catches a lease going stale mid-run, not just at startup)", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("runs the injected reconcile function on its own interval, independent of polling", async () => {
      const claim = vi.fn().mockResolvedValue(null);
      const reconcile = vi.fn().mockResolvedValue(undefined);
      const worker = new Worker({ concurrency: 1, pollIntervalMs: 60_000, reconcileIntervalMs: 5_000, claim, reconcile, onLog, skipAdmission: true });

      worker.start();
      expect(reconcile).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(5_000);
      expect(reconcile).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(5_000);
      expect(reconcile).toHaveBeenCalledTimes(2);
    });

    it("stops on shutdown", async () => {
      const claim = vi.fn().mockResolvedValue(null);
      const reconcile = vi.fn().mockResolvedValue(undefined);
      const worker = new Worker({ concurrency: 1, pollIntervalMs: 60_000, reconcileIntervalMs: 5_000, claim, reconcile, onLog, skipAdmission: true });

      worker.start();
      await worker.shutdown("SIGTERM");
      reconcile.mockClear();

      await vi.advanceTimersByTimeAsync(30_000);
      expect(reconcile).not.toHaveBeenCalled();
    });

    it("a reconciliation failure is logged and does not crash the worker or stop future ticks", async () => {
      const claim = vi.fn().mockResolvedValue(null);
      const reconcile = vi.fn().mockRejectedValue(new Error("DB blip"));
      const worker = new Worker({ concurrency: 1, pollIntervalMs: 60_000, reconcileIntervalMs: 5_000, claim, reconcile, onLog, skipAdmission: true });

      worker.start();
      await vi.advanceTimersByTimeAsync(5_000);

      expect(logs.some((l) => l.includes("periodic reconciliation failed"))).toBe(true);
    });
  });
});
