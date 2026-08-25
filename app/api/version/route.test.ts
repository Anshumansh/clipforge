import { describe, it, expect, beforeEach, afterEach } from "vitest";

const { GET } = await import("./route");

// Regression coverage for the CI SHA-preflight gate (.github/workflows/e2e.yml):
// this endpoint is the only thing standing between "the E2E suite ran" and
// "the E2E suite ran against the commit it thinks it did". It must expose
// exactly these three fields and nothing else from process.env.
describe("GET /api/version", () => {
  const originalSha = process.env.RAILWAY_GIT_COMMIT_SHA;
  const originalEnv = process.env.RAILWAY_ENVIRONMENT_NAME;

  beforeEach(() => {
    delete process.env.RAILWAY_GIT_COMMIT_SHA;
    delete process.env.RAILWAY_ENVIRONMENT_NAME;
  });

  afterEach(() => {
    if (originalSha === undefined) delete process.env.RAILWAY_GIT_COMMIT_SHA;
    else process.env.RAILWAY_GIT_COMMIT_SHA = originalSha;
    if (originalEnv === undefined) delete process.env.RAILWAY_ENVIRONMENT_NAME;
    else process.env.RAILWAY_ENVIRONMENT_NAME = originalEnv;
  });

  it("reports the deployed commit SHA and environment name when Railway provides them", async () => {
    process.env.RAILWAY_GIT_COMMIT_SHA = "3ec87e69c2e74ac25326f0ee3fc58776795bcea0";
    process.env.RAILWAY_ENVIRONMENT_NAME = "staging";

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.gitSha).toBe("3ec87e69c2e74ac25326f0ee3fc58776795bcea0");
    expect(body.environment).toBe("staging");
    expect(typeof body.version).toBe("string");
  });

  it("reports null rather than throwing when not running on Railway", async () => {
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.gitSha).toBeNull();
    expect(body.environment).toBeNull();
  });

  it("never leaks any field beyond gitSha, environment, and version", async () => {
    process.env.RAILWAY_GIT_COMMIT_SHA = "abc123";
    const res = await GET();
    const body = await res.json();

    expect(Object.keys(body).sort()).toEqual(["environment", "gitSha", "version"]);
  });
});
