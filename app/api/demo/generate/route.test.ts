import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const checkAndReserveDemoQuotaFn = vi.fn();
const getClientIpFn = vi.fn();
const getDemoUserIdFn = vi.fn();
const jobCount = vi.fn();
const projectCreate = vi.fn();
const jobCreate = vi.fn();
const executeRaw = vi.fn();

vi.mock("@/lib/demo/quota", () => ({
  checkAndReserveDemoQuota: (...a: unknown[]) => checkAndReserveDemoQuotaFn(...a),
}));
vi.mock("@/lib/rate-limit", () => ({
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
    // The route wraps its own check-then-act sequence (concurrent-job-count
    // admission, separate from quota) in a transaction (advisory lock +
    // count + create) -- pass the same mocked client through as `tx` so
    // existing per-call assertions still see job.count/project.create
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

describe("POST /api/demo/generate (kill switch + persistent quota + concurrency cap)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.DEMO_GENERATION_ENABLED;
    getClientIpFn.mockReturnValue("1.2.3.4");
    getDemoUserIdFn.mockResolvedValue("demo-user-1");
    checkAndReserveDemoQuotaFn.mockResolvedValue({ allowed: true });
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

  it("returns 503 immediately when DEMO_GENERATION_ENABLED=false, without touching the quota check or the DB", async () => {
    process.env.DEMO_GENERATION_ENABLED = "false";

    const res = await POST(makeRequest());

    expect(res.status).toBe(503);
    expect(checkAndReserveDemoQuotaFn).not.toHaveBeenCalled();
    expect(projectCreate).not.toHaveBeenCalled();
  });

  it("still accepts requests when DEMO_GENERATION_ENABLED is unset (default-on, not a behavior change)", async () => {
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
  });

  it("passes the client IP through to the atomic quota check", async () => {
    await POST(makeRequest());
    expect(checkAndReserveDemoQuotaFn).toHaveBeenCalledWith("1.2.3.4");
  });

  it("returns 429 when the per-IP limit is exhausted", async () => {
    checkAndReserveDemoQuotaFn.mockResolvedValue({
      allowed: false,
      reason: "Demo limit for your IP (3 per day) exceeded",
    });

    const res = await POST(makeRequest());

    expect(res.status).toBe(429);
    expect(projectCreate).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.error).toMatch(/you've used your free demos/i);
  });

  it("returns 503 when the company-wide global daily limit is exhausted", async () => {
    checkAndReserveDemoQuotaFn.mockResolvedValue({
      allowed: false,
      reason: "Daily demo budget limit ($200/day) would be exceeded",
    });

    const res = await POST(makeRequest());

    expect(res.status).toBe(503);
    expect(projectCreate).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.error).toMatch(/company-wide limit/i);
  });

  it("never reaches quota admission's own DB write path when quota already rejected the request", async () => {
    checkAndReserveDemoQuotaFn.mockResolvedValue({ allowed: false, reason: "Demo limit for your IP (3 per day) exceeded" });
    await POST(makeRequest());
    // The concurrent-job-count admission transaction is a separate, later
    // check -- confirm it's never reached once quota alone has rejected.
    expect(jobCount).not.toHaveBeenCalled();
  });
});
