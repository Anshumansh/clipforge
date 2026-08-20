import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { PostgresTestDB, ConcurrencyBarrier } from "@/lib/testing/postgres-integration";

/**
 * Phase G: non-production load test of the queue/admission/demo-quota
 * subsystem at 10/25/50/100 simulated users plus a 150-user burst, against
 * real Postgres.
 *
 * SCOPE, stated plainly: this exercises the database/queue layer directly
 * (claimNextQueuedJob, requestAdmission, checkAndReserveDemoQuota) bypassing HTTP,
 * auth/sessions, credit deduction, and every paid AI provider (script/TTS/
 * render). It does not load-test the full HTTP request path and does not
 * spend a cent on a provider call. That boundary is deliberate: this
 * environment cannot run the actual Next.js app server against real user
 * sessions without either calling paid providers for real (out of bounds --
 * "do not purchase infrastructure or activate paid services") or building a
 * second, parallel mock of the entire API surface, which would load-test the
 * mock, not the app. The queue/admission layer is also where Phase C already
 * found and fixed two genuine concurrency bugs, so it's the part of the
 * system where load-bearing correctness was actually in question.
 */
process.env.MAX_ACTIVE_WORKERS = "1"; // matches the documented production default
// 30 here, not lib/demo/quota.ts's real default of 3 -- deliberately higher
// so this load test can actually observe the cap engage at tier sizes above
// 30 without every tier just trivially hitting "3 accepted, rest rejected".
process.env.DEMO_PER_IP_LIMIT = "30";

let activeDb: PrismaClient;
vi.mock("@/lib/db", () => ({
  get db() {
    return activeDb;
  },
}));

const { claimNextQueuedJob } = await import("@/lib/jobs/claim");
const { requestAdmission } = await import("@/lib/workers/admission");
const { checkAndReserveDemoQuota } = await import("@/lib/demo/quota");

interface TierResult {
  label: string;
  claimThroughputPerSec: number;
  avgClaimLatencyMs: number;
  p95ClaimLatencyMs: number;
  doubleClaims: number;
  unclaimedAfterDrain: number;
  raceDoubleClaims: number;
  raceUnclaimedAfterBurst: number;
  raceUnclaimedAfterPollRetries: number;
  raceSweepsToFullyDrain: number;
  admittedCount: number;
  demoAccepted: number;
  demoExpectedAccepted: number;
}

async function seedQueuedJobs(client: PrismaClient, count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const user = await client.user.create({ data: { email: `loadtest-${crypto.randomUUID()}@test.local`, passwordHash: "x" } });
    const project = await client.project.create({
      data: { userId: user.id, type: "script", title: "t", status: "queued", input: "{}" },
    });
    const job = await client.job.create({ data: { userId: user.id, projectId: project.id, type: "render", status: "queued" } });
    ids.push(job.id);
  }
  return ids;
}

async function runClaimTier(client: PrismaClient, jobCount: number): Promise<Pick<TierResult, "claimThroughputPerSec" | "avgClaimLatencyMs" | "p95ClaimLatencyMs" | "doubleClaims" | "unclaimedAfterDrain">> {
  const jobIds = await seedQueuedJobs(client, jobCount);
  const submittedAt = Date.now();

  const claimLatencies: number[] = [];
  const claimedBy = new Map<string, string[]>();

  // Single simulated worker draining the queue -- matches the documented
  // production WORKER_CONCURRENCY=1 default. Loops until it observes the
  // queue genuinely empty, not just one null claim (which could just mean
  // it lost a race and should try again -- see the Phase C retry-loop fix).
  async function workerLoop(workerId: string) {
    while (true) {
      const claimed = await claimNextQueuedJob(workerId);
      if (!claimed) {
        const stillQueued = await client.job.count({ where: { id: { in: jobIds }, status: "queued" } });
        if (stillQueued === 0) return;
        continue;
      }
      claimLatencies.push(Date.now() - submittedAt);
      const list = claimedBy.get(claimed.id) ?? [];
      list.push(workerId);
      claimedBy.set(claimed.id, list);
    }
  }

  const start = Date.now();
  await workerLoop("load-worker-0");
  const totalWallMs = Date.now() - start;

  const doubleClaims = [...claimedBy.values()].filter((w) => w.length > 1).length;
  const unclaimedAfterDrain = await client.job.count({ where: { id: { in: jobIds }, status: "queued" } });

  claimLatencies.sort((a, b) => a - b);
  const avg = claimLatencies.reduce((a, b) => a + b, 0) / (claimLatencies.length || 1);
  const p95 = claimLatencies[Math.floor(claimLatencies.length * 0.95)] ?? 0;

  return {
    claimThroughputPerSec: jobCount / (totalWallMs / 1000 || 1),
    avgClaimLatencyMs: Math.round(avg),
    p95ClaimLatencyMs: p95,
    doubleClaims,
    unclaimedAfterDrain,
  };
}

async function runConcurrentClaimRace(
  client: PrismaClient,
  workerCount: number
): Promise<{ doubleClaims: number; unclaimedAfterBurst: number; unclaimedAfterPollRetries: number; sweepsToFullyDrain: number }> {
  // Genuine race-safety stress: workerCount SIMULTANEOUS workers racing for
  // workerCount jobs in one instant -- extends Phase C's claim.integration.test.ts
  // (which proved this at 6-vs-6) up through 150-vs-150, directly stressing the
  // MAX_CLAIM_RACE_RETRIES retry-loop fix at higher contention than it was
  // originally proven against. Real production runs a single worker today
  // (see runClaimTier above for that measurement) -- this is defense-in-depth
  // verification for if/when that ever changes, not a measurement of today's
  // actual deployed throughput.
  const jobIds = await seedQueuedJobs(client, workerCount);
  const claimedBy = new Map<string, string[]>(); // jobId -> every workerId that ever received it

  function recordClaims(claims: Array<{ id: string; attemptToken: string } | null>) {
    for (const c of claims) {
      if (!c) continue;
      const list = claimedBy.get(c.id) ?? [];
      list.push(c.attemptToken); // attemptToken is unique per successful claim call
      claimedBy.set(c.id, list);
    }
  }

  const barrier = new ConcurrencyBarrier(workerCount);
  const burstClaims = await Promise.all(
    Array.from({ length: workerCount }, async (_, i) => {
      await barrier.wait();
      return claimNextQueuedJob(`load-race-${workerCount}-${i}`);
    })
  );
  recordClaims(burstClaims);
  const unclaimedAfterBurst = await client.job.count({ where: { id: { in: jobIds }, status: "queued" } });

  // A worker that exhausted its retry budget in that one instant of maximal
  // simultaneous contention doesn't lose the job forever in real production --
  // its poll loop simply calls claimNextQueuedJob again on the next tick (a
  // few seconds later, worker/index.ts's tick()). Simulate that here with
  // more sequential sweeps (generous cap; at 150-vs-150 the geometric
  // shrinkage of "still queued" per sweep needs more than a handful of
  // rounds to fully resolve) and confirm every remaining job is still
  // claimable, tracking claims the same way so a double-claim introduced by
  // a retry racing against an already-completed burst claim would show up.
  const MAX_SWEEPS = 30;
  let sweepsUsed = 0;
  for (let sweep = 0; sweep < MAX_SWEEPS; sweep++) {
    const remaining = await client.job.findMany({ where: { id: { in: jobIds }, status: "queued" }, select: { id: true } });
    if (remaining.length === 0) break;
    sweepsUsed = sweep + 1;
    const sweepClaims = await Promise.all(remaining.map((_, i) => claimNextQueuedJob(`load-race-retry-${workerCount}-${sweep}-${i}`)));
    recordClaims(sweepClaims);
  }
  const unclaimedAfterPollRetries = await client.job.count({ where: { id: { in: jobIds }, status: "queued" } });

  // Each jobId's attemptToken list must contain exactly one entry -- more
  // than one means the same job was successfully claimed twice (by burst
  // and/or retry), which is the actual double-claim safety property.
  const doubleClaims = [...claimedBy.values()].filter((tokens) => tokens.length > 1).length;

  return { doubleClaims, unclaimedAfterBurst, unclaimedAfterPollRetries, sweepsToFullyDrain: sweepsUsed };
}

describe("Load test: queue/admission/demo-quota under 10/25/50/100 users + 150 burst (Phase G)", () => {
  let pgTestDb: PostgresTestDB;
  const results: TierResult[] = [];

  beforeAll(async () => {
    pgTestDb = await PostgresTestDB.create();
    activeDb = pgTestDb.createClient();
  }, 60000);

  afterAll(async () => {
    console.log("\n=== LOAD TEST SUMMARY (Phase G) ===");
    console.table(
      results.map((r) => ({
        tier: r.label,
        "claim throughput/s (1 worker)": r.claimThroughputPerSec.toFixed(1),
        "avg claim latency ms": r.avgClaimLatencyMs,
        "p95 claim latency ms": r.p95ClaimLatencyMs,
        "race double-claims (N-vs-N)": r.raceDoubleClaims,
        "unclaimed after 1 burst": r.raceUnclaimedAfterBurst,
        "extra poll sweeps to drain": r.raceSweepsToFullyDrain,
        "admitted (limit=1)": r.admittedCount,
        "demo accepted": `${r.demoAccepted}/${r.demoExpectedAccepted}`,
      }))
    );
    await pgTestDb?.cleanup();
  });

  const tiers = [
    { count: 10, label: "10 users" },
    { count: 25, label: "25 users" },
    { count: 50, label: "50 users" },
    { count: 100, label: "100 users" },
    { count: 150, label: "150-user burst" },
  ];

  for (const tier of tiers) {
    it(`${tier.label}: no double-claims, no lost jobs, admission stays within limit, demo quota caps correctly`, async () => {
      const claimResult = await runClaimTier(activeDb, tier.count);
      const raceResult = await runConcurrentClaimRace(activeDb, tier.count);

      await activeDb.workerRegistration.deleteMany({});
      const admissionResults = await Promise.all(
        Array.from({ length: tier.count }, (_, i) => requestAdmission(`load-admit-${tier.count}-${i}`))
      );
      const admittedCount = await activeDb.workerRegistration.count({ where: { status: "admitted" } });

      await activeDb.demoQuota.deleteMany({});
      const demoIp = `203.0.${tier.count % 256}.1`;
      const demoResults = await Promise.all(Array.from({ length: tier.count }, () => checkAndReserveDemoQuota(demoIp)));
      const demoAccepted = demoResults.filter((r) => r.allowed).length;
      const demoExpected = Math.min(tier.count, 30);

      results.push({
        label: tier.label,
        ...claimResult,
        raceDoubleClaims: raceResult.doubleClaims,
        raceUnclaimedAfterBurst: raceResult.unclaimedAfterBurst,
        raceUnclaimedAfterPollRetries: raceResult.unclaimedAfterPollRetries,
        raceSweepsToFullyDrain: raceResult.sweepsToFullyDrain,
        admittedCount,
        demoAccepted,
        demoExpectedAccepted: demoExpected,
      });

      // The actual safety invariants this load test is proving hold under
      // concurrent load, at every tier from 10 to 150 simulated users:
      expect(claimResult.doubleClaims).toBe(0); // no job ever claimed by two workers (sequential drain)
      expect(claimResult.unclaimedAfterDrain).toBe(0); // every submitted job eventually claimed
      expect(raceResult.doubleClaims).toBe(0); // CRITICAL: no job ever claimed by two workers, even under N-simultaneous-vs-N contention
      // Under extreme SIMULTANEOUS contention some claimers can exhaust their
      // per-call retry budget (MAX_CLAIM_RACE_RETRIES) in that one instant --
      // not data loss, since a real worker's poll loop just tries again a few
      // seconds later. What must hold is eventual drainage with continued
      // polling and zero double-claims introduced along the way (already
      // asserted above) -- proven by the sweep loop inside runConcurrentClaimRace.
      expect(raceResult.unclaimedAfterPollRetries).toBe(0);
      expect(admittedCount).toBeLessThanOrEqual(1); // MAX_ACTIVE_WORKERS=1 never exceeded
      expect(admissionResults.filter(Boolean).length).toBe(admittedCount);
      expect(demoAccepted).toBeLessThanOrEqual(demoExpected); // per-IP demo limit never exceeded
    }, 120000);
  }
});
