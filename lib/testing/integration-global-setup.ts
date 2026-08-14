/**
 * Vitest globalSetup for `npm run test:integration`. Runs once for the whole
 * integration run (not per test file): starts a single real, local,
 * throwaway PostgreSQL server via the `embedded-postgres` package (a real
 * downloaded Postgres binary, not a mock/shim), applies the Prisma schema
 * once to a template database, and publishes connection info to test files
 * via process.env (set here, before Vitest forks worker threads, so it's
 * present in each worker's initial env).
 *
 * This deliberately never reads DATABASE_URL. The only DATABASE_URL
 * configured in this repo's .env points at a live Neon Postgres instance --
 * there is no way to prove from this codebase alone whether that's
 * production, staging, or shared dev, so integration tests must never be
 * able to reach it even by accident. Using a wholly separate, freshly
 * initialised local server makes that structurally impossible rather than
 * relying on a hostname denylist.
 */
import EmbeddedPostgres from "embedded-postgres";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { execSync } from "node:child_process";

const PORT = 15433;
const USER = "clipforge_test";
const PASSWORD = "clipforge_test";
const TEMPLATE_DB = "clipforge_template";

let pg: EmbeddedPostgres | null = null;
let dataDir: string;

export async function setup(): Promise<void> {
  dataDir = path.join(os.tmpdir(), `clipforge-pg-integration-${Date.now()}`);
  fs.mkdirSync(dataDir, { recursive: true });

  pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: USER,
    password: PASSWORD,
    port: PORT,
    persistent: false,
  });

  await pg.initialise();
  await pg.start();
  await pg.createDatabase(TEMPLATE_DB);

  const templateUrl = `postgresql://${USER}:${PASSWORD}@127.0.0.1:${PORT}/${TEMPLATE_DB}`;

  // Apply the real Prisma schema the same way `npm run db:push` does in
  // real dev/deploy -- this project has no valid `prisma migrate deploy`
  // history (see Phase D findings), so `db push` is the only schema-apply
  // path that actually reflects how this app's schema reaches a database
  // today.
  execSync("npx prisma db push --skip-generate --accept-data-loss", {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: templateUrl },
    stdio: "pipe",
  });

  process.env.INTEGRATION_PG_HOST = "127.0.0.1";
  process.env.INTEGRATION_PG_PORT = String(PORT);
  process.env.INTEGRATION_PG_USER = USER;
  process.env.INTEGRATION_PG_PASSWORD = PASSWORD;
  process.env.INTEGRATION_PG_TEMPLATE_DB = TEMPLATE_DB;
}

export async function teardown(): Promise<void> {
  await pg?.stop().catch(() => {});
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
}
