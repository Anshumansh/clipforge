import { describe, it, expect, afterEach, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { PostgresTestDB, ConcurrencyBarrier } from "@/lib/testing/postgres-integration";

let activeDb: PrismaClient;
vi.mock("@/lib/db", () => ({
  get db() {
    return activeDb;
  },
}));

process.env.DEMO_PER_IP_LIMIT = "5";
const { incrementDemoQuota } = await import("@/lib/demo/quota");

// NOTE ON SCOPE: lib/demo/quota.ts is NOT currently called by any API route
// (app/api/demo/generate/route.ts enforces demo limits via the in-memory
// lib/rate-limit.ts instead, which does not persist across restarts or
// aggregate across multiple app instances). This test proves the DB-backed
// primitive in lib/demo/quota.ts is itself correct under real concurrency,
// independent of the fact that it's currently unused dead code -- see the
// Phase C summary for the wiring gap, which is a product/business-limit
// decision (the two paths enforce different numeric limits: 3/day vs
// DEMO_PER_IP_LIMIT=30/day) left for explicit owner sign-off rather than
// silently changed here.
describe("incrementDemoQuota concurrency against real Postgres (Phase C)", () => {
  let pgTestDb: PostgresTestDB | null = null;

  afterEach(async () => {
    await pgTestDb?.cleanup();
    pgTestDb = null;
  });

  it("DEMO_PER_IP_LIMIT=5: 20 concurrent submissions from the same IP -- exactly 5 are accepted, never more", async () => {
    pgTestDb = await PostgresTestDB.create();
    activeDb = pgTestDb.createClient();

    const CONCURRENT_SUBMISSIONS = 20;
    const barrier = new ConcurrencyBarrier(CONCURRENT_SUBMISSIONS);
    const results = await Promise.all(
      Array.from({ length: CONCURRENT_SUBMISSIONS }, async () => {
        await barrier.wait();
        return incrementDemoQuota("203.0.113.42");
      })
    );

    const acceptedCount = results.filter((ok) => ok === true).length;
    expect(acceptedCount).toBe(5);
    expect(results.filter((ok) => ok === false).length).toBe(15);
  });

  it("two different IPs racing concurrently each get their own independent limit, not a shared one", async () => {
    pgTestDb = await PostgresTestDB.create();
    activeDb = pgTestDb.createClient();

    const barrier = new ConcurrencyBarrier(10);
    const results = await Promise.all([
      ...Array.from({ length: 5 }, async () => {
        await barrier.wait();
        return incrementDemoQuota("203.0.113.1");
      }),
      ...Array.from({ length: 5 }, async () => {
        await barrier.wait();
        return incrementDemoQuota("198.51.100.1");
      }),
    ]);

    // Each IP has its own limit of 5, and both sets of 5 concurrent
    // submissions should all be accepted (5 <= limit for each independently).
    expect(results.filter(Boolean).length).toBe(10);
  });
});
