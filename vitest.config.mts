import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    // The backup-code tests hash 8 codes with bcryptjs (pure-JS, no native
    // binding -- chosen so the Docker image doesn't need a bcrypt build step)
    // and came within ~0.8s of the 5s default under light load; a slower CI
    // runner or a run alongside other work can tip that over. 15s gives real
    // headroom without masking an actual hang (a genuine infinite loop still
    // fails loudly, just later).
    testTimeout: 15000,
  },
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, ".") },
  },
});
