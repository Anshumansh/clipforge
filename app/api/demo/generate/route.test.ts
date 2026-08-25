import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const rateLimitFn = vi.fn();
const getClientIpFn = vi.fn();
const getDemoUserIdFn = vi.fn();
const jobCount = vi.fn();
const projectCreate = vi.fn();
const jobCreate = vi.fn();
const executeRaw = vi.fn();

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: (...a: unknown[]) => rateLimitFn(...a),
  getClientIp: (...a: unknown[]) => getClientIpFn(...a),
}));
vi.mock("@/lib/demo-user", () => ({ getDemoUserId: (...a: unknown[]) => getDemoUserIdFn(...a) }));
const mockDb = {
  job: { count: (...a: unknown[]) => jobCount(...a), create: (...a: unknown[]) => jobCreate(...a) },
  project: { create: (...a: unknown[]) => projectCreate(...a) },
  $executeRaw: (...a: unknown[]) => executeRaw(...a),
};
vi.mock("@/lib/db", () => ({
  db: {
    ...mockDb,
    // The route wraps its check-then-act sequence in a transaction (advisory
    // lock + count + create) -- pass the same mocked client through as `tx`
    // so existing per-call assertions still see job.count/project.create
    // invoked, same as lib/jobs/repurpose-runner.test.ts's $transaction mock.
    $transaction: (fn: (tx: typeof mockDb) => Promise<unknown>) => fn(mockDb),
  },
}));

const { POST } = await import("@/app/api/demo/generate/route");

function makeRequest(topic = "A perfectly reasonable demo topic about mornings") {
  return new Request("https://forgecut.app/api/demo/generate", {
    method: "POST",
    body: JSON.stringify({ topic }),
  });
}

describe("POST /api/demo/generate (TEST-001 + global cap + kill switch)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.DEMO_GENERATION_ENABLED;
    delete process.env.DEMO_GLOBAL_LIMIT_PER_DAY;
    getClientIpFn.mockReturnValue("1.2.3.4");
    getDemoUserIdFn.mockResolvedValue("demo-user-1");
    rateLimitFn.mockReturnValue({ ok: true, remaining: 2, resetAt: Date.now() + 1000 });
    jobCount.mockResolvedValue(0);
    projectCreate.mockResolvedValue({ id: "proj-1" });
    jobCreate.mockResolvedValue({ id: "job-1" });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("accepts a valid request when enabled and under all limits", async () => {
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ projectId: "proj-1" });
  });

  it("returns 503 immediately when DEMO_GENERATION_ENABLED=false, without touching rate limiters or the DB", async () => {
    process.env.DEMO_GENERATION_ENABLED = "false";

    const res = await POST(makeRequest());

    expect(res.status).toBe(503);
    expect(rateLimitFn).not.toHaveBeenCalled();
    expect(projectCreate).not.toHaveBeenCalled();
  });

  it("still accepts requests when DEMO_GENERATION_ENABLED is unset (default-on, not a behavior change)", async () => {
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
  });

  it("returns 429 when the per-IP limit is exhausted, checked before the global limit", async () => {
    rateLimitFn.mockImplementation((key: string) =>
      key.startsWith("demo-generate:1.2.3.4")
        ? { ok: false, remaining: 0, resetAt: Date.now() }
        : { ok: true, remaining: 100, resetAt: Date.now() }
    );

    const res = await POST(makeRequest());

    expect(res.status).toBe(429);
    expect(projectCreate).not.toHaveBeenCalled();
  });

  it("returns 503 when the company-wide global daily limit is exhausted, even though this IP has quota left", async () => {
    rateLimitFn.mockImplementation((key: string) =>
      key === "demo-generate:global"
        ? { ok: false, remaining: 0, resetAt: Date.now() }
        : { ok: true, remaining: 2, resetAt: Date.now() }
    );

    const res = await POST(makeRequest());

    expect(res.status).toBe(503);
    expect(projectCreate).not.toHaveBeenCalled();
  });

  it("checks the global limit using a fixed shared key, independent of client IP", async () => {
    await POST(makeRequest());
    expect(rateLimitFn).toHaveBeenCalledWith("demo-generate:global", 200, 24 * 60 * 60 * 1000);
  });

  it("respects DEMO_GLOBAL_LIMIT_PER_DAY when configured", async () => {
    process.env.DEMO_GLOBAL_LIMIT_PER_DAY = "50";
    await POST(makeRequest());
    expect(rateLimitFn).toHaveBeenCalledWith("demo-generate:global", 50, 24 * 60 * 60 * 1000);
  });
});
