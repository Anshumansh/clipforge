import { describe, it, expect, afterEach, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { PostgresTestDB, ConcurrencyBarrier } from "@/lib/testing/postgres-integration";

// claimNextQueuedJob/renewLease/etc. import `db` from "@/lib/db" at module
// load time. To exercise the REAL production functions against a REAL,
// per-test Postgres database (not the app's own DATABASE_URL), we mock
// "@/lib/db" with a getter that reads a mutable binding this file controls --
// each test points it at its own freshly cloned database before calling into
// claim.ts, so the code under test is byte-for-byte what runs in production,
// just pointed at an isolated instance.
let activeDb: PrismaClient;
vi.mock("@/lib/db", () => ({
  get db() {
    return activeDb;
  },
}));

const { claimNextQueuedJob, renewLease, LeaseLostError } = await import("@/lib/jobs/claim");

async function seedQueuedJob(client: PrismaClient, overrides: { priority?: number } = {}) {
  const user = await client.user.create({ data: { email: `u-${crypto.randomUUID()}@test.local`, passwordHash: "x" } });
  const project = await client.project.create({
    data: { userId: user.id, type: "script", title: "t", status: "queued", input: "{}" },
  });
  const job = await client.job.create({
    data: { userId: user.id, projectId: project.id, type: "render", status: "queued", priority: overrides.priority ?? 0 },
  });
  return { user, project, job };
}

describe("claimNextQueuedJob / renewLease against real Postgres (Phase C)", () => {
  let pgTestDb: PostgresTestDB | null = null;

  afterEach(async () => {
    await pgTestDb?.cleanup();
    pgTestDb = null;
  });

  it("two workers racing to claim the SAME single queued job: exactly one wins, the other gets null", async () => {
    pgTestDb = await PostgresTestDB.create();
    activeDb = pgTestDb.createClient();
    const { job } = await seedQueuedJob(activeDb);

    // Force both claim attempts to actually overlap in time rather than
    // hoping two Promise.all'd calls happen to interleave -- both workers
    // block here until both have arrived, then race the real UPDATE.
    const barrier = new ConcurrencyBarrier(2);
    async function claimAsWorker(workerId: string) {
      await barrier.wait();
      return claimNextQueuedJob(workerId);
    }

    const [resultA, resultB] = await Promise.all([claimAsWorker("worker-a"), claimAsWorker("worker-b")]);

    const winners = [resultA, resultB].filter((r) => r !== null);
    expect(winners).toHaveLength(1);
    expect([resultA, resultB].filter((r) => r === null)).toHaveLength(1);
    expect(winners[0]!.id).toBe(job.id);

    // The DB must agree: exactly one workerId stamped on the row, matching the winner's attemptToken.
    const row = await activeDb.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(row.status).toBe("processing");
    expect(row.attemptToken).toBe(winners[0]!.attemptToken);
  });

  it("N workers racing for N queued jobs: every job claimed exactly once, no worker claims two, no attemptToken reused", async () => {
    pgTestDb = await PostgresTestDB.create();
    activeDb = pgTestDb.createClient();

    const JOB_COUNT = 6;
    const jobs = [];
    for (let i = 0; i < JOB_COUNT; i++) {
      jobs.push((await seedQueuedJob(activeDb)).job);
    }

    const barrier = new ConcurrencyBarrier(JOB_COUNT);
    const claims = await Promise.all(
      Array.from({ length: JOB_COUNT }, async (_, i) => {
        await barrier.wait();
        return claimNextQueuedJob(`worker-${i}`);
      })
    );

    const claimedIds = claims.filter((c) => c !== null).map((c) => c!.id);
    const attemptTokens = claims.filter((c) => c !== null).map((c) => c!.attemptToken);

    // Every one of the JOB_COUNT jobs was claimed by exactly one of the JOB_COUNT workers.
    expect(new Set(claimedIds).size).toBe(JOB_COUNT);
    expect(new Set(claimedIds)).toEqual(new Set(jobs.map((j) => j.id)));
    // No two winners share an attemptToken.
    expect(new Set(attemptTokens).size).toBe(JOB_COUNT);

    const rows = await activeDb.job.findMany({ where: { id: { in: jobs.map((j) => j.id) } } });
    expect(rows.every((r) => r.status === "processing")).toBe(true);
  });

  it("a stale worker's renewLease throws LeaseLostError after the job is reassigned to another worker (real UPDATE, real row)", async () => {
    pgTestDb = await PostgresTestDB.create();
    activeDb = pgTestDb.createClient();
    const { job } = await seedQueuedJob(activeDb);

    const claimed = await claimNextQueuedJob("worker-original");
    expect(claimed).not.toBeNull();

    // Simulate reconciliation reassigning this job after the original
    // worker's lease genuinely expired -- a different worker now owns the row.
    await activeDb.job.update({
      where: { id: job.id },
      data: { workerId: "worker-new", attemptToken: crypto.randomUUID(), heartbeatAt: new Date() },
    });

    // The original (now-stale) worker's heartbeat fires with its OLD attemptToken.
    await expect(renewLease(job.id, "worker-original", claimed!.attemptToken)).rejects.toThrow(LeaseLostError);

    // The reassigned worker's own renewLease (correct attemptToken) must still succeed.
    const newRow = await activeDb.job.findUniqueOrThrow({ where: { id: job.id } });
    await expect(renewLease(job.id, "worker-new", newRow.attemptToken!)).resolves.toBeUndefined();
  });

  it("priority ordering holds under concurrent claims: higher-priority jobs are claimed before lower-priority ones even with multiple workers racing", async () => {
    pgTestDb = await PostgresTestDB.create();
    activeDb = pgTestDb.createClient();

    const lowPriority = await seedQueuedJob(activeDb, { priority: -10 }); // demo tier
    const highPriority = await seedQueuedJob(activeDb, { priority: 0 }); // standard tier

    // Single worker claims twice in sequence -- first claim must be the
    // higher-priority job regardless of insertion order.
    const first = await claimNextQueuedJob("worker-a");
    expect(first!.id).toBe(highPriority.job.id);

    const second = await claimNextQueuedJob("worker-a");
    expect(second!.id).toBe(lowPriority.job.id);
  });
});
