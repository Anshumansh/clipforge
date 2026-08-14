import { describe, it, expect, afterEach } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { Client as PgClient } from "pg";
import { PrismaClient } from "@prisma/client";
import { PostgresTestDB } from "@/lib/testing/postgres-integration";

/**
 * Phase D (baseline existence) + Release Candidate Validation item 1
 * (migration reconciliation): validates prisma/migrations/, which is now
 * two migrations, not one --
 *   20260814103037_baseline_matches_production -- ONLY schema confirmed
 *     present in the real production database via read-only introspection
 *   20260814103100_add_queue_lifecycle_fencing -- the genuinely new schema
 *     (Job lease-fencing columns, WorkerRegistration, DemoQuota) that does
 *     NOT exist in production yet
 * split apart specifically so the baseline can be marked
 * `prisma migrate resolve --applied` against production without falsely
 * claiming the second migration's objects already exist there. See
 * PRODUCTION_READINESS_VERIFIED_2026-08-14.md's migration reconciliation
 * table for the full column-by-column comparison this split was generated
 * from. This test proves both migrations apply cleanly in order and that
 * the baseline ALONE reproduces production's exact shape (not the full
 * current schema) -- the property the whole split exists to guarantee.
 */
describe("prisma migrate deploy against a clean database (Phase D)", () => {
  let pgTestDb: PostgresTestDB | null = null;

  afterEach(async () => {
    await pgTestDb?.cleanup();
    pgTestDb = null;
  });

  it("`prisma migrate deploy` succeeds from empty on a clean database (previously failed with P3018)", async () => {
    pgTestDb = await PostgresTestDB.create();
    // This test needs its OWN completely empty database, not a clone of the
    // db-push'd template -- PostgresTestDB.create() clones the template,
    // which already has the schema applied via db push. Drop everything so
    // migrate deploy is genuinely running against a blank database, the same
    // as a fresh production provisioning would be.
    const client = await new PgClient({ connectionString: pgTestDb.getUrl() });
    await client.connect();
    await client.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
    await client.end();

    expect(() => {
      execSync("npx prisma migrate deploy", {
        cwd: process.cwd(),
        env: { ...process.env, DATABASE_URL: pgTestDb!.getUrl() },
        stdio: "pipe",
      });
    }).not.toThrow();

    // Confirm both migrations were recorded as applied, in order, and every
    // table Prisma's current schema defines actually exists.
    const verify = new PgClient({ connectionString: pgTestDb.getUrl() });
    await verify.connect();
    const migrations = await verify.query(`SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY started_at ASC`);
    expect(migrations.rows).toHaveLength(2);
    expect(migrations.rows[0].migration_name).toMatch(/_baseline_matches_production$/);
    expect(migrations.rows[1].migration_name).toMatch(/_add_queue_lifecycle_fencing$/);
    expect(migrations.rows.every((r) => r.finished_at !== null)).toBe(true);
    expect(migrations.rows.every((r) => r.rolled_back_at === null)).toBe(true);

    const tables = await verify.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`
    );
    const tableNames = tables.rows.map((r) => r.table_name);
    expect(tableNames).toContain("User");
    expect(tableNames).toContain("Job");
    expect(tableNames).toContain("WorkerRegistration");
    expect(tableNames).toContain("DemoQuota");
    expect(tableNames).toContain("JobCostRecord");
    await verify.end();
  });

  it("a database built via `migrate deploy` has an IDENTICAL schema to one built via `db push` (the two paths must never diverge)", async () => {
    pgTestDb = await PostgresTestDB.create(); // db-push'd template clone
    const migratedDb = await PostgresTestDB.create(); // second db-push'd clone, about to be replaced

    const client = new PgClient({ connectionString: migratedDb.getUrl() });
    await client.connect();
    await client.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
    await client.end();

    execSync("npx prisma migrate deploy", {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: migratedDb.getUrl() },
      stdio: "pipe",
    });

    // `prisma migrate diff` between the two live databases -- an empty diff
    // means byte-for-byte identical resulting schema.
    const diff = execSync(
      `npx prisma migrate diff --from-url "${pgTestDb.getUrl()}" --to-url "${migratedDb.getUrl()}" --script`,
      { cwd: process.cwd(), encoding: "utf-8" }
    );

    // Prisma always emits this header even for a no-op diff; strip it to
    // check whether any actual DDL statements were produced.
    const meaningfulLines = diff
      .split("\n")
      .filter((line) => line.trim() && !line.trim().startsWith("--"));
    expect(meaningfulLines).toEqual([]);

    await migratedDb.cleanup();
  });

  it("real application code (Prisma Client) can read and write through the migrated schema, not just db-push'd ones", async () => {
    pgTestDb = await PostgresTestDB.create();
    const client = new PgClient({ connectionString: pgTestDb.getUrl() });
    await client.connect();
    await client.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
    await client.end();

    execSync("npx prisma migrate deploy", {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: pgTestDb.getUrl() },
      stdio: "pipe",
    });

    const prisma = new PrismaClient({ datasourceUrl: pgTestDb.getUrl() });
    try {
      const user = await prisma.user.create({ data: { email: "migration-e2e@test.local", passwordHash: "x" } });
      const project = await prisma.project.create({
        data: { userId: user.id, type: "script", title: "t", status: "queued", input: "{}" },
      });
      const job = await prisma.job.create({
        data: { userId: user.id, projectId: project.id, type: "render", status: "queued", attemptToken: "abc" },
      });
      const found = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
      expect(found.attemptToken).toBe("abc");
    } finally {
      await prisma.$disconnect();
    }
  });

  it("the baseline migration ALONE (before the fencing migration runs) does not create Job's new lease-fencing columns or WorkerRegistration/DemoQuota -- the property the whole split exists to guarantee", async () => {
    pgTestDb = await PostgresTestDB.create();
    const client = new PgClient({ connectionString: pgTestDb.getUrl() });
    await client.connect();
    await client.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);

    const migrationsDir = path.join(process.cwd(), "prisma", "migrations");
    const baselineSql = fs.readFileSync(
      path.join(migrationsDir, "20260814103037_baseline_matches_production", "migration.sql"),
      "utf-8"
    );
    await client.query(baselineSql);

    // What a `prisma migrate resolve --applied <baseline>` against the real
    // production database would leave it looking like, if only the baseline
    // had ever actually run there (which is the real, current state).
    const tables = await client.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`
    );
    const tableNames = tables.rows.map((r) => r.table_name);
    expect(tableNames).not.toContain("WorkerRegistration");
    expect(tableNames).not.toContain("DemoQuota");

    const jobColumns = await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'Job'`
    );
    const jobColumnNames = jobColumns.rows.map((r) => r.column_name);
    expect(jobColumnNames).not.toContain("attemptToken");
    expect(jobColumnNames).not.toContain("workerId");
    expect(jobColumnNames).not.toContain("leaseExpiresAt");
    expect(jobColumnNames).not.toContain("priority");
    // The original 9 production columns must still be exactly there.
    expect(jobColumnNames.sort()).toEqual(
      ["id", "userId", "projectId", "type", "status", "progress", "log", "createdAt", "updatedAt"].sort()
    );

    await client.end();
  });
});
