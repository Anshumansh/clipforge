import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.integration.test.ts"],
    globalSetup: ["lib/testing/integration-global-setup.ts"],
    // Sequential across files: PostgresTestDB.create() clones each test's
    // database via `CREATE DATABASE ... TEMPLATE`, which requires no other
    // connection be active against the template at that instant. Running
    // files in parallel would make that a race instead of a guarantee.
    // Concurrency *within* a test (multiple simulated workers against one
    // cloned database) is unaffected -- that's real parallelism against
    // real Postgres, which is the entire point of these tests.
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
  },
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, ".") },
  },
});
