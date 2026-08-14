import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const getTokenFn = vi.fn();
vi.mock("next-auth/jwt", () => ({ getToken: (...a: unknown[]) => getTokenFn(...a) }));

const { default: middleware } = await import("./middleware");

function req(path: string, opts: { auth?: string } = {}): NextRequest {
  const headers = new Headers();
  if (opts.auth) headers.set("authorization", opts.auth);
  return new NextRequest(new URL(`https://staging.example.com${path}`), { headers });
}

function basicAuthHeader(user: string, pass: string): string {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
}

describe("middleware — staging protection (Release Candidate Validation item 3)", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    getTokenFn.mockResolvedValue(null);
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("has zero effect when STAGING_ENVIRONMENT is unset (production behavior unchanged)", async () => {
    delete process.env.STAGING_ENVIRONMENT;
    const res = await middleware(req("/pricing"));
    expect(res.status).not.toBe(401);
    expect(res.headers.get("X-Robots-Tag")).toBeNull();
  });

  it("blocks an unauthenticated request with 401 + WWW-Authenticate when staging mode is on", async () => {
    process.env.STAGING_ENVIRONMENT = "true";
    process.env.STAGING_BASIC_AUTH_USER = "staging";
    process.env.STAGING_BASIC_AUTH_PASSWORD = "correct-horse";

    const res = await middleware(req("/"));

    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toContain("Basic");
  });

  it("blocks a request with the WRONG basic-auth credentials", async () => {
    process.env.STAGING_ENVIRONMENT = "true";
    process.env.STAGING_BASIC_AUTH_USER = "staging";
    process.env.STAGING_BASIC_AUTH_PASSWORD = "correct-horse";

    const res = await middleware(req("/", { auth: basicAuthHeader("staging", "wrong-password") }));

    expect(res.status).toBe(401);
  });

  it("allows a request with the CORRECT basic-auth credentials, and sets X-Robots-Tag noindex", async () => {
    process.env.STAGING_ENVIRONMENT = "true";
    process.env.STAGING_BASIC_AUTH_USER = "staging";
    process.env.STAGING_BASIC_AUTH_PASSWORD = "correct-horse";

    const res = await middleware(req("/", { auth: basicAuthHeader("staging", "correct-horse") }));

    expect(res.status).not.toBe(401);
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex, nofollow, noarchive");
  });

  it("fails closed: blocks everything if staging mode is on but no credentials are configured", async () => {
    process.env.STAGING_ENVIRONMENT = "true";
    delete process.env.STAGING_BASIC_AUTH_USER;
    delete process.env.STAGING_BASIC_AUTH_PASSWORD;

    const res = await middleware(req("/"));

    expect(res.status).toBe(401);
  });

  it.each(["/api/health", "/api/health/live", "/api/stripe/webhook", "/api/internal/metrics"])(
    "exempts %s from basic auth even in staging mode (health checks, Stripe signatures, metrics bearer auth)",
    async (path) => {
      process.env.STAGING_ENVIRONMENT = "true";
      process.env.STAGING_BASIC_AUTH_USER = "staging";
      process.env.STAGING_BASIC_AUTH_PASSWORD = "correct-horse";

      const res = await middleware(req(path));

      expect(res.status).not.toBe(401);
    }
  );

  it("still redirects an unauthenticated /dashboard request to /login (existing behavior preserved)", async () => {
    delete process.env.STAGING_ENVIRONMENT;
    getTokenFn.mockResolvedValue(null);

    const res = await middleware(req("/dashboard"));

    expect(res.status).toBe(307); // NextResponse.redirect default
    expect(res.headers.get("location")).toContain("/login");
  });

  it("lets an authenticated /dashboard request through (existing behavior preserved)", async () => {
    delete process.env.STAGING_ENVIRONMENT;
    getTokenFn.mockResolvedValue({ sub: "user-1" });

    const res = await middleware(req("/dashboard"));

    expect(res.status).not.toBe(307);
  });

  it("in staging mode, a /dashboard request needs BOTH basic auth AND a session token", async () => {
    process.env.STAGING_ENVIRONMENT = "true";
    process.env.STAGING_BASIC_AUTH_USER = "staging";
    process.env.STAGING_BASIC_AUTH_PASSWORD = "correct-horse";
    getTokenFn.mockResolvedValue(null); // no session

    const res = await middleware(req("/dashboard", { auth: basicAuthHeader("staging", "correct-horse") }));

    // Basic auth passed, but no session -> redirected to login, not a raw 401.
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });
});
