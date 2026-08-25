import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { PostgresTestDB, ConcurrencyBarrier } from "@/lib/testing/postgres-integration";

let activeDb: PrismaClient;
vi.mock("@/lib/db", () => ({
  get db() {
    return activeDb;
  },
}));

const { checkAndReserveDemoQuota, getDemoQuotaStats } = await import("@/lib/demo/quota");
const { CREDITS_PER_VIDEO } = await import("@/lib/credits");

// This module is now the single source of truth for demo quota enforcement
// -- app/api/demo/generate/route.ts calls checkAndReserveDemoQuota directly,
// replacing the in-memory counter that used to live there. These tests
// prove the properties that matter specifically because this is now live:
// real concurrency safety (not just "looks right" from reading the code),
// no stored-count overshoot on a rejected request, and correct UTC-day
// scoping -- against a real Postgres, not mocks.
//
// getDemoPerIpLimit/getDemoGlobalLimitPerDay read process.env fresh on every
// call (not frozen at module import) specifically so each test below can
// set exactly the limit it's testing without leaking into the others --
// every test that isn't specifically about the global cap sets it far
// higher than anything the test could plausibly spend, so only the
// per-IP logic is actually under test there.
const EFFECTIVELY_UNLIMITED_GLOBAL_CAP = "1000000";

describe("checkAndReserveDemoQuota against real Postgres", () => {
  let pgTestDb: PostgresTestDB | null = null;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.DEMO_PER_IP_LIMIT = "5";
    process.env.DEMO_GLOBAL_LIMIT_PER_DAY = EFFECTIVELY_UNLIMITED_GLOBAL_CAP;
  });

  afterEach(async () => {
    await pgTestDb?.cleanup();
    pgTestDb = null;
    process.env = { ...originalEnv };
  });

  it("DEMO_PER_IP_LIMIT=5: 20 concurrent submissions from the same IP -- exactly 5 accepted, never more", async () => {
    pgTestDb = await PostgresTestDB.create();
    activeDb = pgTestDb.createClient();

    const CONCURRENT_SUBMISSIONS = 20;
    const barrier = new ConcurrencyBarrier(CONCURRENT_SUBMISSIONS);
    const results = await Promise.all(
      Array.from({ length: CONCURRENT_SUBMISSIONS }, async () => {
        await barrier.wait();
        return checkAndReserveDemoQuota("203.0.113.42");
      })
    );

    const acceptedCount = results.filter((r) => r.allowed).length;
    expect(acceptedCount).toBe(5);
    expect(results.filter((r) => !r.allowed).length).toBe(15);
  });

  it("a rejected submission never inflates the stored count past the limit (no overshoot)", async () => {
    pgTestDb = await PostgresTestDB.create();
    activeDb = pgTestDb.createClient();

    const CONCURRENT_SUBMISSIONS = 20;
    const barrier = new ConcurrencyBarrier(CONCURRENT_SUBMISSIONS);
    await Promise.all(
      Array.from({ length: CONCURRENT_SUBMISSIONS }, async () => {
        await barrier.wait();
        return checkAndReserveDemoQuota("203.0.113.99");
      })
    );

    // The naive check-then-increment this replaced would leave the stored
    // count at 20 here (every attempt increments, only the first 5 report
    // success) -- permanently over-blocking this IP for the rest of the UTC
    // day even though only 5 submissions should count against it.
    const stats = await getDemoQuotaStats("203.0.113.99");
    expect(stats.submissionCount).toBe(5);
  });

  it("two different IPs racing concurrently each get their own independent limit, not a shared one", async () => {
    pgTestDb = await PostgresTestDB.create();
    activeDb = pgTestDb.createClient();

    const barrier = new ConcurrencyBarrier(10);
    const results = await Promise.all([
      ...Array.from({ length: 5 }, async () => {
        await barrier.wait();
        return checkAndReserveDemoQuota("203.0.113.1");
      }),
      ...Array.from({ length: 5 }, async () => {
        await barrier.wait();
        return checkAndReserveDemoQuota("198.51.100.1");
      }),
    ]);

    expect(results.filter((r) => r.allowed).length).toBe(10);
  });

  it("the global daily limit is enforced across many different IPs, even though each is under its own per-IP limit", async () => {
    // Scoped to just this test: a real, low global cap in dollars, with
    // DEMO_PER_IP_LIMIT left high enough (50) that the per-IP check can
    // never be what's actually stopping any of these distinct-IP submitters.
    process.env.DEMO_PER_IP_LIMIT = "50";
    process.env.DEMO_GLOBAL_LIMIT_PER_DAY = "1";

    pgTestDb = await PostgresTestDB.create();
    activeDb = pgTestDb.createClient();

    const costPerDemo = CREDITS_PER_VIDEO * 0.1;
    const submitterCount = Math.ceil(1 / costPerDemo) + 10; // guaranteed to exceed the global cap

    const barrier = new ConcurrencyBarrier(submitterCount);
    const results = await Promise.all(
      Array.from({ length: submitterCount }, async (_, i) => {
        await barrier.wait();
        return checkAndReserveDemoQuota(`198.51.100.${i + 1}`); // distinct IP each
      })
    );

    const acceptedCount = results.filter((r) => r.allowed).length;
    const expectedAccepted = Math.floor(1 / costPerDemo);
    expect(acceptedCount).toBe(expectedAccepted);
    expect(acceptedCount).toBeLessThan(submitterCount);
    expect(results.some((r) => !r.allowed && !r.allowed && r.reason.includes("budget limit"))).toBe(true);
  });

  it("a quota row from a prior UTC day never counts against today", async () => {
    pgTestDb = await PostgresTestDB.create();
    activeDb = pgTestDb.createClient();

    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    yesterday.setUTCHours(0, 0, 0, 0);

    // Seed a row for "yesterday" already at the per-IP limit.
    await activeDb.demoQuota.create({
      data: {
        ipAddress: "203.0.113.200.0/24",
        utcDate: yesterday,
        submissionCount: 5,
        estimatedCost: 5 * CREDITS_PER_VIDEO * 0.1,
      },
    });

    // Today's request from the (anonymized) same IP must not see yesterday's
    // exhausted count.
    const result = await checkAndReserveDemoQuota("203.0.113.200");
    expect(result.allowed).toBe(true);
  });

  it("never stores the raw IP address -- only the /24 (or /64 for IPv6) network prefix", async () => {
    pgTestDb = await PostgresTestDB.create();
    activeDb = pgTestDb.createClient();

    await checkAndReserveDemoQuota("203.0.113.77");
    const rows = await activeDb.demoQuota.findMany();

    expect(rows).toHaveLength(1);
    expect(rows[0].ipAddress).not.toBe("203.0.113.77");
    expect(rows[0].ipAddress).toBe("203.0.113.0/24");
  });
});
