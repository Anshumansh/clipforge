import { defineConfig, devices } from "@playwright/test";

// E2E_BASE_URL defaults to staging, never production -- a suite that's
// meant to grow account-creating, checkout-flowing tests (see tests/e2e/)
// must not have production as its silent default target. Pass
// E2E_BASE_URL explicitly (and consciously) to point it anywhere else.
const baseURL = process.env.E2E_BASE_URL || "https://clipforge-v2-staging.up.railway.app";
const authenticatedRun = process.env.E2E_AUTHENTICATED_RUN === "true";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [["list"], ["html", { open: "never" }]],
  // Real renders take a minute or two (see hero-demo.tsx) -- default
  // per-test timeout needs real headroom for anything that waits on one.
  timeout: 3 * 60 * 1000,
  use: {
    baseURL,
    // Authenticated CI uses a dedicated account whose credentials come from
    // GitHub Actions secrets. Never persist its cookies, form contents, or
    // logged-in pages in a trace, screenshot, or video artifact.
    trace: authenticatedRun ? "off" : "retain-on-failure",
    screenshot: authenticatedRun ? "off" : "only-on-failure",
    video: authenticatedRun ? "off" : "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "mobile-chrome", use: { ...devices["Pixel 7"] } },
  ],
});
