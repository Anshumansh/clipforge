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
 */
import { db } from "@/lib/db";
import { claimNextQueuedJob, reconcileAbandonedProcessingJobs, type ClaimedJob, type JobType } from "@/lib/jobs/claim";
import { runScriptJob } from "@/lib/jobs/script-runner";
import { runRepurposeJob } from "@/lib/jobs/repurpose-runner";
import { runUgcJob } from "@/lib/jobs/ugc-runner";

export interface WorkerOptions {
  concurrency: number;
  pollIntervalMs: number;
  runners?: Record<JobType, (jobId: string) => Promise<void>>;
  claim?: () => Promise<ClaimedJob | null>;
  onLog?: (line: string) => void;
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
export class Worker {
  private active = 0;
  private shuttingDown = false;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly inFlight = new Set<Promise<void>>();
  private readonly runners: Record<JobType, (jobId: string) => Promise<void>>;
  private readonly claim: () => Promise<ClaimedJob | null>;
  private readonly log: (line: string) => void;
  readonly instanceId = crypto.randomUUID().slice(0, 8);

  constructor(private readonly options: WorkerOptions) {
    this.runners = options.runners ?? DEFAULT_RUNNERS;
    this.claim = options.claim ?? claimNextQueuedJob;
    this.log = options.onLog ?? ((line: string) => console.log(line));
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
   * is full or nothing is queued. */
  async tick(): Promise<void> {
    if (this.shuttingDown) return;

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
   * claim attempt is ever slow. */
  start(): void {
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
  }

  /** Stops claiming new jobs immediately, then waits for whatever's
   * already in flight to finish before resolving. Does not itself exit the
   * process -- the caller decides that (see main() below), so tests can
   * call this directly without a real process exiting mid-suite. */
  async shutdown(signal: string): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    this.log(
      `[worker:${this.instanceId}] received ${signal} -- draining ${this.inFlight.size} in-flight job(s), no new jobs will be claimed`
    );
    if (this.pollTimer) clearTimeout(this.pollTimer);
    await Promise.allSettled([...this.inFlight]);
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
  console.log(
    "[worker] this phase supports exactly ONE worker process/container against this database. " +
      "Startup reconciliation below assumes no other worker is concurrently processing jobs -- " +
      "do not scale this service. See lib/jobs/claim.ts and OPERATIONS.md."
  );

  await waitForDb();

  console.log(
    "[worker] reconciling processing jobs abandoned by a previous crash (queued jobs are left alone -- single-worker assumption)"
  );
  await reconcileAbandonedProcessingJobs();

  const worker = new Worker(config);
  worker.start();

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
