/**
 * Phase 3 (production stability / render worker isolation, 2026-08-12):
 * the real worker entrypoint. Runs as its own Docker service, independent
 * of the Next.js web process -- see docker-compose.yml's `worker` service
 * and OPERATIONS.md's "Render worker" section.
 *
 * Responsibilities: poll the database for queued jobs, atomically claim
 * one at a time (lib/jobs/claim.ts), dispatch to the matching runner
 * (script/repurpose/ugc), and stay alive across individual job failures.
 * The runners themselves (lib/jobs/{script,repurpose,ugc}-runner.ts) are
 * unchanged from Phase 2/2.1 -- they already own reservation capture/
 * release, JobCostRecord writes, and Project/Job status updates.
 *
 * IMPORTANT -- single worker only: exactly one instance of this process
 * is supported against a given database in this phase. See the
 * single-worker-assumption doc comment on reconcileAbandonedProcessingJobs
 * in lib/jobs/claim.ts, and OPERATIONS.md's WORKER_REPLICAS note. Job
 * CLAIMING itself is safe under multiple concurrent workers (the
 * conditional UPDATE in claimNextQueuedJob only ever lets one claimant win
 * a given row) -- it's specifically startup reconciliation that assumes no
 * other worker is concurrently, legitimately processing a "processing" job.
 *
 * Queue-lifecycle hardening (scale/100-user-readiness branch, 2026-08-13):
 * a claimed job's lease is now renewed periodically for as long as it's in
 * flight (see the heartbeat interval in `tick()` below) and
 * reconcileAbandonedProcessingJobs now also runs on a recurring timer, not
 * just at startup -- a lease can go stale mid-run (a hang, not just a
 * crash-before-restart), not only at the moment this process boots.
 */
import { db } from "@/lib/db";
import {
  claimNextQueuedJob,
  reconcileAbandonedProcessingJobs,
  renewLease,
  LEASE_DURATION_MS,
  type ClaimedJob,
  type JobType,
} from "@/lib/jobs/claim";
import {
  requestAdmission,
  renewAdmissionHeartbeat,
  retireRegistration,
  ADMISSION_CHECK_INTERVAL_MS,
} from "@/lib/workers/admission";
import { runScriptJob } from "@/lib/jobs/script-runner";
import { runRepurposeJob } from "@/lib/jobs/repurpose-runner";
import { runUgcJob } from "@/lib/jobs/ugc-runner";

export interface WorkerOptions {
  concurrency: number;
  pollIntervalMs: number;
  /** How often a periodic reconciliation sweep runs while the worker is
   * live, in addition to the mandatory startup sweep. Defaults to a third
   * of LEASE_DURATION_MS, so a stale lease is typically caught well before
   * a second full lease period elapses. */
  reconcileIntervalMs?: number;
  runners?: Record<JobType, (jobId: string) => Promise<void>>;
  claim?: () => Promise<ClaimedJob | null>;
  renewLease?: (jobId: string, workerId: string, attemptToken: string) => Promise<void>;
  reconcile?: () => Promise<void>;
  onLog?: (line: string) => void;
  /** For tests: skip distributed admission control and start immediately. */
  skipAdmission?: boolean;
}

const DEFAULT_RUNNERS: Record<JobType, (jobId: string) => Promise<void>> = {
  script: runScriptJob,
  repurpose: runRepurposeJob,
  ugc: runUgcJob,
};

/** WORKER_CONCURRENCY defaults to 1, not the render pipeline's previously
 * documented "2 concurrent" ceiling -- the audit measured ~3.3GB peak RAM
 * per render on a 7.6GB VPS and an OOM incident already occurred there.
 * Moving rendering into its own container must actually protect the web
 * process, not just relocate the same memory pressure -- raise this only
 * after measuring real per-worker-container memory headroom in production,
 * never automatically. */
export function readWorkerConfigFromEnv(): { concurrency: number; pollIntervalMs: number } {
  const rawConcurrency = Number(process.env.WORKER_CONCURRENCY ?? "1");
  const rawPollInterval = Number(process.env.WORKER_POLL_INTERVAL_MS ?? "3000");
  return {
    concurrency: Number.isFinite(rawConcurrency) && rawConcurrency > 0 ? Math.floor(rawConcurrency) : 1,
    pollIntervalMs: Number.isFinite(rawPollInterval) && rawPollInterval > 0 ? Math.floor(rawPollInterval) : 3000,
  };
}

/**
 * Owns the poll/claim/dispatch loop and graceful shutdown. Deliberately a
 * plain class (not a bare module-level loop) so tests can construct one
 * with mocked `claim`/`runners`/`onLog` and drive `tick()`/`shutdown()`
 * directly instead of needing real timers, a real DB, or real OS signals.
 */
const DEFAULT_HEARTBEAT_INTERVAL_MS = Math.floor(LEASE_DURATION_MS / 3);

export class Worker {
  private active = 0;
  private shuttingDown = false;
  private admitted = false;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private reconcileTimer: ReturnType<typeof setInterval> | null = null;
  private admissionTimer: ReturnType<typeof setInterval> | null = null;
  private readonly inFlight = new Set<Promise<void>>();
  private readonly runners: Record<JobType, (jobId: string) => Promise<void>>;
  private readonly claim: () => Promise<ClaimedJob | null>;
  private readonly renewLeaseFn: (jobId: string, workerId: string, attemptToken: string) => Promise<void>;
  private readonly reconcileFn: () => Promise<void>;
  private readonly log: (line: string) => void;
  private readonly skipAdmission: boolean;
  readonly instanceId = crypto.randomUUID().slice(0, 8);

  constructor(private readonly options: WorkerOptions) {
    this.runners = options.runners ?? DEFAULT_RUNNERS;
    // Bound to this.instanceId, not passed separately -- claimNextQueuedJob
    // needs to know which worker is claiming so it can stamp the lease.
    // instanceId is a field declared above the constructor, so it's already
    // initialized by the time this runs.
    this.claim = options.claim ?? (() => claimNextQueuedJob(this.instanceId));
    this.renewLeaseFn = options.renewLease ?? renewLease;
    this.reconcileFn = options.reconcile ?? reconcileAbandonedProcessingJobs;
    this.log = options.onLog ?? ((line: string) => console.log(line));
    this.skipAdmission = options.skipAdmission ?? false;
    // For tests that skip admission, start as already admitted
    this.admitted = this.skipAdmission;
  }

  get activeCount(): number {
    return this.active;
  }

  get isShuttingDown(): boolean {
    return this.shuttingDown;
  }

  get inFlightCount(): number {
    return this.inFlight.size;
  }

  /** Claims and starts jobs up to the concurrency limit. Never awaits a
   * job to completion -- claiming is fast (a couple of DB round trips);
   * execution runs detached so polling keeps working while renders are in
   * flight. Safe to call repeatedly; a no-op once the concurrency budget
   * is full or nothing is queued. Also checks if this worker is still admitted;
   * stops polling if admission was revoked. */
  async tick(): Promise<void> {
    if (this.shuttingDown) return;

    // If not admitted, stop polling (another worker took the slot)
    if (!this.admitted) {
      this.log(`[worker:${this.instanceId}] not admitted, stopping poll loop`);
      this.shuttingDown = true;
      return;
    }

    while (this.active < this.options.concurrency) {
      let claimed: ClaimedJob | null;
      try {
        claimed = await this.claim();
      } catch (err) {
        this.log(`[worker:${this.instanceId}] claim attempt failed: ${err instanceof Error ? err.message : String(err)}`);
        break;
      }
      if (!claimed) break; // nothing queued right now

      this.active++;
      const start = Date.now();
      this.log(`[worker:${this.instanceId}] job claimed id=${claimed.id} type=${claimed.type}`);

      // Renews this job's lease periodically for as long as it's in
      // flight, independent of whatever internal step the runner is on --
      // simpler and safer than threading heartbeat calls through each
      // runner's own AI-gen/voiceover/broll/render/upload steps, and still
      // gives the core safety property: a live worker's lease never goes
      // stale, so reconciliation never mistakes an actually-running job for
      // an abandoned one. The attemptToken prevents stale workers from
      // extending expired leases.
      const heartbeat = setInterval(() => {
        void this.renewLeaseFn(claimed.id, this.instanceId, claimed.attemptToken);
      }, DEFAULT_HEARTBEAT_INTERVAL_MS);

      const runner = this.runners[claimed.type];
      const jobPromise: Promise<void> = runner(claimed.id)
        .then(() => {
          this.log(
            `[worker:${this.instanceId}] job completed id=${claimed.id} type=${claimed.type} durationMs=${Date.now() - start}`
          );
        })
        .catch((err: unknown) => {
          // The runners already catch their own internal errors and mark
          // the job/project failed + release the reservation -- this catch
          // is a defensive backstop for a genuinely unexpected throw (e.g.
          // a bug inside the runner's own catch block), so one bad job can
          // never crash the poll loop or take any other in-flight job down
          // with it.
          this.log(
            `[worker:${this.instanceId}] job failed unexpectedly id=${claimed.id} type=${claimed.type}: ${err instanceof Error ? err.message : String(err)}`
          );
        })
        .finally(() => {
          clearInterval(heartbeat);
          this.active--;
          this.inFlight.delete(jobPromise);
          // A slot just freed up -- look for more work immediately rather
          // than waiting for the next poll tick. Demand-driven, not a busy
          // loop: claim() returns null (breaking the while loop above) the
          // moment there's nothing queued.
          if (!this.shuttingDown) void this.tick();
        });
      this.inFlight.add(jobPromise);
    }
  }

  /** Starts the poll loop. Uses setTimeout (re-armed after each tick
   * completes), not setInterval, so overlapping ticks can't stack up if a
   * claim attempt is ever slow. Also starts a separate, slower periodic
   * reconciliation sweep -- catches a lease that goes stale mid-run (a
   * hang), not just one that was already stale at startup.
   *
   * This is a convenience method for tests and simple configurations.
   * For production with distributed admission control, use startWithAdmission()
   * which first requests an admission slot before polling begins. */
  start(): void {
    this.startPolling();
  }

  /** Starts the poll loop with distributed worker admission control.
   * First requests an admission slot from the pool, then starts polling.
   * Throws if admission is denied (another worker holds the only slot). */
  async startWithAdmission(): Promise<void> {
    // Request admission before starting the poll loop
    this.admitted = await requestAdmission(this.instanceId);

    if (!this.admitted) {
      // Another worker holds the only slot; exit gracefully
      this.log(`[worker:${this.instanceId}] failed to obtain admission, exiting`);
      await retireRegistration(this.instanceId);
      throw new Error("Failed to obtain worker admission: capacity is full");
    }

    // Start the admission heartbeat renewal (separate from job lease heartbeats)
    this.admissionTimer = setInterval(() => {
      void renewAdmissionHeartbeat(this.instanceId).then((stillAdmitted) => {
        this.admitted = stillAdmitted;
      });
    }, ADMISSION_CHECK_INTERVAL_MS);

    this.startPolling();
  }

  /** Starts the main poll/reconciliation loop. Called by both start() and startWithAdmission(). */
  private startPolling(): void {
    this.log(
      `[worker:${this.instanceId}] polling started -- concurrency=${this.options.concurrency} pollIntervalMs=${this.options.pollIntervalMs}`
    );
    const scheduleNext = () => {
      if (this.shuttingDown) return;
      this.pollTimer = setTimeout(() => {
        void this.tick().finally(scheduleNext);
      }, this.options.pollIntervalMs);
    };
    void this.tick();
    scheduleNext();

    const reconcileIntervalMs = this.options.reconcileIntervalMs ?? Math.floor(LEASE_DURATION_MS / 1.5);
    this.reconcileTimer = setInterval(() => {
      void this.reconcileFn().catch((e) =>
        this.log(`[worker:${this.instanceId}] periodic reconciliation failed: ${e instanceof Error ? e.message : String(e)}`)
      );
    }, reconcileIntervalMs);
  }

  /** Stops claiming new jobs immediately, then waits for whatever's
   * already in flight to finish before resolving. Cleans up timers and
   * retires the worker registration. Does not itself exit the process --
   * the caller decides that (see main() below), so tests can call this
   * directly without a real process exiting mid-suite. */
  async shutdown(signal: string): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    this.log(
      `[worker:${this.instanceId}] received ${signal} -- draining ${this.inFlight.size} in-flight job(s), no new jobs will be claimed`
    );
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (this.reconcileTimer) clearInterval(this.reconcileTimer);
    if (this.admissionTimer) clearInterval(this.admissionTimer);
    await Promise.allSettled([...this.inFlight]);
    await retireRegistration(this.instanceId);
    this.log(`[worker:${this.instanceId}] shutdown complete`);
  }
}

async function waitForDb(maxAttempts = 5): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await db.$queryRaw`SELECT 1`;
      console.log("[worker] database connection healthy");
      return;
    } catch (err) {
      console.error(
        `[worker] database connection attempt ${attempt}/${maxAttempts} failed:`,
        err instanceof Error ? err.message : err
      );
      if (attempt === maxAttempts) throw err;
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }
}

async function main(): Promise<void> {
  const config = readWorkerConfigFromEnv();
  console.log(`[worker] starting -- concurrency=${config.concurrency} pollIntervalMs=${config.pollIntervalMs}`);

  await waitForDb();

  console.log(
    "[worker] reconciling processing jobs with a stale/missing lease (queued jobs are left alone)"
  );
  await reconcileAbandonedProcessingJobs();

  const worker = new Worker(config);

  try {
    await worker.startWithAdmission();
  } catch (err) {
    console.error("[worker] failed to start:", err instanceof Error ? err.message : err);
    process.exit(1);
  }

  let shuttingDown = false;
  const handleSignal = (signal: string) => {
    if (shuttingDown) return; // a second Ctrl-C etc. shouldn't restart the drain
    shuttingDown = true;
    void worker.shutdown(signal).then(() => process.exit(0));
  };
  process.on("SIGTERM", () => handleSignal("SIGTERM"));
  process.on("SIGINT", () => handleSignal("SIGINT"));
}

// Guarded so importing this module from a test (which mocks @/lib/db and
// the runners first) never triggers a real DB connection, real timers, or
// real process-exit calls -- tests exercise the exported Worker class
// directly instead. Vitest always sets process.env.VITEST for code running
// under it.
if (!process.env.VITEST) {
  main().catch((err) => {
    console.error("[worker] fatal startup error:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
