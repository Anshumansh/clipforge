/**
 * PostgreSQL integration test utilities: real Postgres, real separate
 * connections per simulated worker, real row locking -- not mocks.
 *
 * Connects only to the local embedded Postgres server started once by
 * lib/testing/integration-global-setup.ts (see that file for why this never
 * reads DATABASE_URL). Each PostgresTestDB.create() call clones a fresh,
 * isolated database from the schema-applied template via `CREATE DATABASE
 * ... TEMPLATE`, so tests can run with real concurrent Prisma clients
 * against real Postgres without touching each other's data or requiring a
 * schema push per test.
 *
 * Usage in a *.integration.test.ts file:
 *   const pg = await PostgresTestDB.create();
 *   const client1 = pg.createClient();
 *   const client2 = pg.createClient();
 *   try {
 *     await runConcurrentTest(client1, client2);
 *   } finally {
 *     await pg.cleanup();
 *   }
 */

import { PrismaClient } from "@prisma/client";
import { Client as PgClient } from "pg";
import * as crypto from "crypto";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Integration tests must run via 'npm run test:integration' ` +
      `(which loads lib/testing/integration-global-setup.ts) -- they cannot run under the ` +
      `plain 'npm test' unit-test config.`
    );
  }
  return value;
}

function adminUrl(database: string): string {
  const host = requireEnv("INTEGRATION_PG_HOST");
  const port = requireEnv("INTEGRATION_PG_PORT");
  const user = requireEnv("INTEGRATION_PG_USER");
  const password = requireEnv("INTEGRATION_PG_PASSWORD");
  return `postgresql://${user}:${password}@${host}:${port}/${database}`;
}

export class PostgresTestDB {
  private dbName: string;
  private dbUrl: string;
  private clients: PrismaClient[] = [];

  private constructor(dbName: string, dbUrl: string) {
    this.dbName = dbName;
    this.dbUrl = dbUrl;
  }

  /** Clones a fresh, isolated database from the schema-applied template. */
  static async create(): Promise<PostgresTestDB> {
    const templateDb = requireEnv("INTEGRATION_PG_TEMPLATE_DB");
    const testId = crypto.randomBytes(6).toString("hex");
    const dbName = `test_${testId}`;

    const admin = new PgClient({ connectionString: adminUrl("postgres") });
    await admin.connect();
    try {
      // TEMPLATE requires no other active connections to the template DB at
      // the moment of the copy -- the integration vitest config runs test
      // files sequentially (fileParallelism: false) specifically so this
      // never races against another file's CREATE DATABASE.
      await admin.query(`CREATE DATABASE "${dbName}" TEMPLATE "${templateDb}"`);
    } finally {
      await admin.end();
    }

    return new PostgresTestDB(dbName, adminUrl(dbName));
  }

  createClient(): PrismaClient {
    const client = new PrismaClient({ datasourceUrl: this.dbUrl });
    this.clients.push(client);
    return client;
  }

  getUrl(): string {
    return this.dbUrl;
  }

  async cleanup(): Promise<void> {
    for (const client of this.clients) {
      await client.$disconnect().catch(() => {});
    }
    this.clients = [];

    const admin = new PgClient({ connectionString: adminUrl("postgres") });
    await admin.connect();
    try {
      // FORCE (PG13+) disconnects any lingering client connections so a test
      // that forgot to $disconnect one of its clients can't block cleanup.
      await admin.query(`DROP DATABASE IF EXISTS "${this.dbName}" WITH (FORCE)`);
    } finally {
      await admin.end();
    }
  }
}

/**
 * Barrier for coordinating test steps across concurrent simulated workers.
 * Ensures all workers reach the barrier before any proceed -- used to force
 * a genuine race (e.g. two workers both past "read the job as queued" and
 * both about to attempt the claim UPDATE at the same instant) instead of
 * hoping two async calls happen to interleave.
 */
export class ConcurrencyBarrier {
  private totalWaiters: number;
  private arrivals: number = 0;
  private resolvers: ((value: void) => void)[] = [];

  constructor(totalWaiters: number) {
    if (totalWaiters <= 0) throw new Error("totalWaiters must be > 0");
    this.totalWaiters = totalWaiters;
  }

  async wait(): Promise<void> {
    this.arrivals++;
    if (this.arrivals === this.totalWaiters) {
      for (const resolver of this.resolvers) resolver();
      return;
    }
    return new Promise((resolve) => {
      this.resolvers.push(resolve);
    });
  }
}

/** Latch for triggering events across test workers. One worker counts down, others wait. */
export class CountdownLatch {
  private count: number;
  private resolvers: ((value: void) => void)[] = [];

  constructor(initialCount: number) {
    if (initialCount <= 0) throw new Error("initialCount must be > 0");
    this.count = initialCount;
  }

  async countDown(): Promise<void> {
    this.count--;
    if (this.count === 0) {
      for (const resolver of this.resolvers) resolver();
    }
  }

  async wait(): Promise<void> {
    if (this.count === 0) return;
    return new Promise((resolve) => {
      this.resolvers.push(resolve);
    });
  }

  getCount(): number {
    return this.count;
  }
}
