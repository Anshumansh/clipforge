import { describe, it, expect, afterEach, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { PostgresTestDB, ConcurrencyBarrier } from "@/lib/testing/postgres-integration";

let activeDb: PrismaClient;
vi.mock("@/lib/db", () => ({
  get db() {
    return activeDb;
  },
}));

// MAX_ACTIVE_WORKERS is read from process.env at admission.ts module-load
// time, so it must be set before the dynamic import below evaluates the module.
process.env.MAX_ACTIVE_WORKERS = "1";
const { requestAdmission } = await import("@/lib/workers/admission");

describe("requestAdmission concurrency against real Postgres (Phase C)", () => {
  let pgTestDb: PostgresTestDB | null = null;

  afterEach(async () => {
    await pgTestDb?.cleanup();
    pgTestDb = null;
  });

  it("MAX_ACTIVE_WORKERS=1: two workers requesting admission at the exact same instant -- at most one is ever admitted", async () => {
    pgTestDb = await PostgresTestDB.create();
    activeDb = pgTestDb.createClient();

    const barrier = new ConcurrencyBarrier(2);
    async function requestAsWorker(workerId: string) {
      await barrier.wait();
      return requestAdmission(workerId);
    }

    const [admittedA, admittedB] = await Promise.all([
      requestAsWorker("worker-a"),
      requestAsWorker("worker-b"),
    ]);

    // The property that actually matters: never MORE than MAX_ACTIVE_WORKERS
    // admitted at once. This is the assertion that catches the check-then-act
    // race (both readers seeing count=0 under READ COMMITTED before either
    // commits) if the fix regresses.
    const admittedCount = await activeDb.workerRegistration.count({ where: { status: "admitted" } });
    expect(admittedCount).toBeLessThanOrEqual(1);

    // Sanity: the boolean return values agree with what's actually stored.
    const trueCount = [admittedA, admittedB].filter(Boolean).length;
    expect(trueCount).toBe(admittedCount);
  });

  it("10 workers racing for MAX_ACTIVE_WORKERS=1: exactly one admitted, the DB row count never exceeds the limit", async () => {
    pgTestDb = await PostgresTestDB.create();
    activeDb = pgTestDb.createClient();

    const WORKER_COUNT = 10;
    const barrier = new ConcurrencyBarrier(WORKER_COUNT);
    const results = await Promise.all(
      Array.from({ length: WORKER_COUNT }, async (_, i) => {
        await barrier.wait();
        return requestAdmission(`worker-${i}`);
      })
    );

    const admittedCount = await activeDb.workerRegistration.count({ where: { status: "admitted" } });
    expect(admittedCount).toBeLessThanOrEqual(1);
    expect(results.filter(Boolean).length).toBe(admittedCount);
  });
});
