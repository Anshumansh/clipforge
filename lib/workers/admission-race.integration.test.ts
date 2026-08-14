import { describe, it, expect, afterEach } from "vitest";
import { Client as PgClient } from "pg";
import { PostgresTestDB } from "@/lib/testing/postgres-integration";

/**
 * Deterministic proof (not timing-dependent) of whether requestAdmission()'s
 * check-then-act pattern (SELECT COUNT admitted, then INSERT if under limit,
 * all inside one db.$transaction) is actually race-safe under Postgres's
 * default READ COMMITTED isolation.
 *
 * lib/workers/admission.integration.test.ts drives this through the real
 * requestAdmission() function with a JS-level barrier and did NOT observe
 * more than 1 admitted worker even with 10 concurrent callers -- but a
 * passing concurrency test only proves "not observed this run," not "cannot
 * happen," because network/engine overhead can prevent two transactions'
 * vulnerable statements from ever truly overlapping even when the JS calls
 * start at the same instant.
 *
 * This test reproduces the EXACT statement sequence requestAdmission() runs
 * (DELETE stale, SELECT COUNT admitted, INSERT if under limit) using two raw
 * `pg` connections with explicit BEGIN/step control, so the interleaving is
 * deterministic instead of hoped-for: both transactions' SELECT COUNT runs
 * before either COMMITs. If Postgres's read-committed MVCC snapshot lets both
 * see the pre-insert count, this proves the race is real and requestAdmission
 * needs a stronger guard (e.g. SELECT ... FOR UPDATE on a fixed sentinel row,
 * or a partial unique index enforcing at most MAX_ACTIVE_WORKERS admitted
 * rows) rather than relying on transaction wrapping alone.
 */
describe("requestAdmission's check-then-act pattern under deterministic READ COMMITTED interleaving (Phase C)", () => {
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

  it("two transactions' SELECT COUNT both run before either COMMITs -- both must see the same pre-insert count under READ COMMITTED", async () => {
    pgTestDb = await PostgresTestDB.create();
    const url = pgTestDb.getUrl();

    txA = new PgClient({ connectionString: url });
    txB = new PgClient({ connectionString: url });
    await txA.connect();
    await txB.connect();

    await txA.query("BEGIN");
    await txB.query("BEGIN");

    // Mirror requestAdmission()'s exact reads: no stale rows to delete, then count admitted.
    await txA.query(`DELETE FROM "WorkerRegistration" WHERE "lastHeartbeat" < now() - interval '60 seconds' AND status = 'admitted'`);
    const countA = await txA.query(`SELECT COUNT(*)::int AS n FROM "WorkerRegistration" WHERE status = 'admitted'`);

    // txB's SELECT COUNT runs here, deliberately BEFORE txA has inserted or committed anything.
    await txB.query(`DELETE FROM "WorkerRegistration" WHERE "lastHeartbeat" < now() - interval '60 seconds' AND status = 'admitted'`);
    const countB = await txB.query(`SELECT COUNT(*)::int AS n FROM "WorkerRegistration" WHERE status = 'admitted'`);

    expect(countA.rows[0].n).toBe(0);
    // The crux: does txB's read-committed snapshot also see 0, even though
    // it ran its own SELECT strictly after txA's (same wall-clock ordering
    // Prisma's $transaction would produce under real concurrent callers)?
    expect(countB.rows[0].n).toBe(0);

    const now = new Date();
    await txA.query(
      `INSERT INTO "WorkerRegistration" ("workerId", "registeredAt", "lastHeartbeat", status, "createdAt") VALUES ($1, $2, $2, 'admitted', $2)`,
      ["worker-a", now]
    );
    await txB.query(
      `INSERT INTO "WorkerRegistration" ("workerId", "registeredAt", "lastHeartbeat", status, "createdAt") VALUES ($1, $2, $2, 'admitted', $2)`,
      ["worker-b", now]
    );

    // Both inserts target different primary keys (workerId), so neither
    // blocks or conflicts with the other -- both COMMITs succeed.
    await txA.query("COMMIT");
    await txB.query("COMMIT");

    const verify = new PgClient({ connectionString: url });
    await verify.connect();
    const finalCount = await verify.query(`SELECT COUNT(*)::int AS n FROM "WorkerRegistration" WHERE status = 'admitted'`);
    await verify.end();

    // THE PROOF: with MAX_ACTIVE_WORKERS=1, requestAdmission()'s check-then-act
    // pattern is NOT safe under this exact, deterministic interleaving --
    // both transactions computed shouldAdmit=true from the same pre-insert
    // count and both committed a distinct 'admitted' row. This is a real gap,
    // just one that requires unlucky-enough timing to hit in practice (which
    // is exactly why the timing-based test above didn't catch it).
    expect(finalCount.rows[0].n).toBe(2);
  });

  it("with the pg_advisory_xact_lock fix, the second transaction's lock acquisition blocks until the first commits, so it correctly counts 1 instead of 0", async () => {
    pgTestDb = await PostgresTestDB.create();
    const url = pgTestDb.getUrl();

    txA = new PgClient({ connectionString: url });
    txB = new PgClient({ connectionString: url });
    await txA.connect();
    await txB.connect();

    const LOCK_KEY = "822310147"; // matches ADMISSION_LOCK_KEY in lib/workers/admission.ts

    await txA.query("BEGIN");
    await txA.query(`SELECT pg_advisory_xact_lock(${LOCK_KEY})`);
    const countA = await txA.query(`SELECT COUNT(*)::int AS n FROM "WorkerRegistration" WHERE status = 'admitted'`);
    expect(countA.rows[0].n).toBe(0);

    await txB.query("BEGIN");
    // txB's lock acquisition must block (txA still holds it) -- fire it
    // without awaiting yet, and use a short race against a timeout to prove
    // it's genuinely blocked, not just slow.
    const bLockPromise = txB.query(`SELECT pg_advisory_xact_lock(${LOCK_KEY})`);
    let bLockResolved = false;
    void bLockPromise.then(() => {
      bLockResolved = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(bLockResolved).toBe(false); // still blocked -- txA hasn't committed yet

    const now = new Date();
    await txA.query(
      `INSERT INTO "WorkerRegistration" ("workerId", "registeredAt", "lastHeartbeat", status, "createdAt") VALUES ($1, $2, $2, 'admitted', $2)`,
      ["worker-a", now]
    );
    await txA.query("COMMIT"); // releases the advisory lock

    // Now txB's lock call unblocks.
    await bLockPromise;
    expect(bLockResolved).toBe(true);

    // Because txA already committed before txB's lock was granted, txB's
    // count now correctly reflects 1 -- the exact defect the previous test
    // proved is fixed by holding the lock across the whole check-then-act span.
    const countB = await txB.query(`SELECT COUNT(*)::int AS n FROM "WorkerRegistration" WHERE status = 'admitted'`);
    expect(countB.rows[0].n).toBe(1);
    await txB.query("ROLLBACK");
  });
});
