import { describe, it, expect, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { Client as PgClient } from "pg";
import { PrismaClient } from "@prisma/client";
import { PostgresTestDB } from "@/lib/testing/postgres-integration";

/**
 * Phase D: validates the newly generated prisma/migrations/*_baseline
 * migration (see commit history for why it was needed -- the repo had 3
 * incremental migration files with no baseline covering the core schema,
 * so `prisma migrate deploy` failed outright on a clean database with
 * P3018 "relation Job does not exist"). This test proves the FIX, using
 * the same real local Postgres infrastructure as the Phase C tests.
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

    // Confirm the migration was actually recorded as applied, and every
    // table Prisma's schema defines actually exists.
    const verify = new PgClient({ connectionString: pgTestDb.getUrl() });
    await verify.connect();
    const migrations = await verify.query(`SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations"`);
    expect(migrations.rows).toHaveLength(1);
    expect(migrations.rows[0].migration_name).toMatch(/_baseline$/);
    expect(migrations.rows[0].finished_at).not.toBeNull();
    expect(migrations.rows[0].rolled_back_at).toBeNull();

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
});
