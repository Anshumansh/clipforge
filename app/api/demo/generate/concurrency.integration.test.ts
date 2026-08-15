import { describe, it, expect, afterEach } from "vitest";
import { Client as PgClient } from "pg";
import { PostgresTestDB } from "@/lib/testing/postgres-integration";

/**
 * Deterministic proof that POST /api/demo/generate's "at most
 * MAX_CONCURRENT_DEMO_JOBS active demo jobs" invariant is safe under
 * concurrent requests -- same class of check-then-act race as worker
 * admission (lib/workers/admission-race.integration.test.ts), reproduced
 * here via two raw `pg` connections with explicit BEGIN/step control so the
 * interleaving is deterministic instead of hoped-for.
 *
 * Found live: a staging load test fired 50 concurrent POSTs to this route
 * from the same IP and the DB showed 3 demo jobs created within 8ms of each
 * other for the same demo user (queued/processing simultaneously) --
 * confirming the pre-fix route's plain `db.job.count()` then `db.project
 * .create()` (no shared transaction) let multiple requests all read "0
 * active" before any of them had committed their insert.
 */
describe("demo/generate's active-job-count check-then-act pattern under deterministic READ COMMITTED interleaving", () => {
  let pgTestDb: PostgresTestDB | null = null;
  let txA: PgClient | null = null;
  let txB: PgClient | null = null;

  afterEach(async () => {
    await txA?.end().catch(() => {});
    await txB?.end().catch(() => {});
    txA = null;
    txB = null;
    await pgTestDb?.cleanup();
    pgTestDb = null;
  });

  async function seedDemoUser(url: string): Promise<string> {
    const setup = new PgClient({ connectionString: url });
    await setup.connect();
    const res = await setup.query(
      `INSERT INTO "User" (id, email, "passwordHash", plan, "createdAt")
       VALUES ('demo-user-1', 'demo@internal.forgecut.app', 'unused', 'free', now())
       RETURNING id`
    );
    await setup.end();
    return res.rows[0].id;
  }

  it("without a shared lock, both transactions' SELECT COUNT run before either COMMITs -- both see 0 active and both insert, exceeding the cap of 1", async () => {
    pgTestDb = await PostgresTestDB.create();
    const url = pgTestDb.getUrl();
    const demoUserId = await seedDemoUser(url);

    txA = new PgClient({ connectionString: url });
    txB = new PgClient({ connectionString: url });
    await txA.connect();
    await txB.connect();

    await txA.query("BEGIN");
    await txB.query("BEGIN");

    // Mirror the pre-fix route's exact reads: count queued/processing jobs for the demo user.
    const countA = await txA.query(
      `SELECT COUNT(*)::int AS n FROM "Job" WHERE "userId" = $1 AND status IN ('queued', 'processing')`,
      [demoUserId]
    );
    // txB's count runs here, deliberately before txA has inserted or committed anything.
    const countB = await txB.query(
      `SELECT COUNT(*)::int AS n FROM "Job" WHERE "userId" = $1 AND status IN ('queued', 'processing')`,
      [demoUserId]
    );

    expect(countA.rows[0].n).toBe(0);
    expect(countB.rows[0].n).toBe(0);

    const now = new Date();
    await txA.query(
      `INSERT INTO "Project" (id, "userId", type, title, status, input, "createdAt", "updatedAt") VALUES ($1, $2, 'script', 'a', 'queued', '{}', $3, $3)`,
      ["proj-a", demoUserId, now]
    );
    await txA.query(
      `INSERT INTO "Job" (id, "userId", "projectId", type, status, priority, "createdAt", "updatedAt") VALUES ($1, $2, $3, 'render', 'queued', 0, $4, $4)`,
      ["job-a", demoUserId, "proj-a", now]
    );
    await txB.query(
      `INSERT INTO "Project" (id, "userId", type, title, status, input, "createdAt", "updatedAt") VALUES ($1, $2, 'script', 'b', 'queued', '{}', $3, $3)`,
      ["proj-b", demoUserId, now]
    );
    await txB.query(
      `INSERT INTO "Job" (id, "userId", "projectId", type, status, priority, "createdAt", "updatedAt") VALUES ($1, $2, $3, 'render', 'queued', 0, $4, $4)`,
      ["job-b", demoUserId, "proj-b", now]
    );

    await txA.query("COMMIT");
    await txB.query("COMMIT");

    const verify = new PgClient({ connectionString: url });
    await verify.connect();
    const finalCount = await verify.query(
      `SELECT COUNT(*)::int AS n FROM "Job" WHERE "userId" = $1 AND status IN ('queued', 'processing')`,
      [demoUserId]
    );
    await verify.end();

    // THE PROOF: with MAX_CONCURRENT_DEMO_JOBS=1, the unguarded check-then-act
    // pattern is not safe under this exact interleaving -- both transactions
    // computed "under the cap" from the same pre-insert snapshot and both
    // committed a job, exceeding the intended limit of 1.
    expect(finalCount.rows[0].n).toBe(2);
  });

  it("with the pg_advisory_xact_lock fix (matching the deployed route), the second transaction's lock acquisition blocks until the first commits, so it correctly counts 1 instead of 0", async () => {
    pgTestDb = await PostgresTestDB.create();
    const url = pgTestDb.getUrl();
    const demoUserId = await seedDemoUser(url);

    txA = new PgClient({ connectionString: url });
    txB = new PgClient({ connectionString: url });
    await txA.connect();
    await txB.connect();

    const LOCK_KEY = "419662003"; // matches DEMO_ADMISSION_LOCK_KEY in app/api/demo/generate/route.ts

    await txA.query("BEGIN");
    await txA.query(`SELECT pg_advisory_xact_lock(${LOCK_KEY})`);
    const countA = await txA.query(
      `SELECT COUNT(*)::int AS n FROM "Job" WHERE "userId" = $1 AND status IN ('queued', 'processing')`,
      [demoUserId]
    );
    expect(countA.rows[0].n).toBe(0);

    await txB.query("BEGIN");
    const bLockPromise = txB.query(`SELECT pg_advisory_xact_lock(${LOCK_KEY})`);
    let bLockResolved = false;
    void bLockPromise.then(() => {
      bLockResolved = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(bLockResolved).toBe(false); // still blocked -- txA hasn't committed yet

    const now = new Date();
    await txA.query(
      `INSERT INTO "Project" (id, "userId", type, title, status, input, "createdAt", "updatedAt") VALUES ($1, $2, 'script', 'a', 'queued', '{}', $3, $3)`,
      ["proj-a", demoUserId, now]
    );
    await txA.query(
      `INSERT INTO "Job" (id, "userId", "projectId", type, status, priority, "createdAt", "updatedAt") VALUES ($1, $2, $3, 'render', 'queued', 0, $4, $4)`,
      ["job-a", demoUserId, "proj-a", now]
    );
    await txA.query("COMMIT"); // releases the advisory lock

    await bLockPromise;
    expect(bLockResolved).toBe(true);

    // txB now correctly sees 1 active job and would reject rather than admit a second.
    const countB = await txB.query(
      `SELECT COUNT(*)::int AS n FROM "Job" WHERE "userId" = $1 AND status IN ('queued', 'processing')`,
      [demoUserId]
    );
    expect(countB.rows[0].n).toBe(1);
    await txB.query("ROLLBACK");
  });
});
