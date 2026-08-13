import { describe, it, expect, beforeEach, vi } from "vitest";
import { GET } from "./route";

// Mock Next.js
vi.mock("next/server", () => ({
  NextResponse: {
    json: (data: unknown, options: { status?: number }) =>
      new Response(JSON.stringify(data), { status: options?.status || 200 }),
  },
}));

// Mock database
vi.mock("@/lib/db", () => ({
  db: {
    job: {
      count: vi.fn().mockResolvedValue(5),
      findFirst: vi.fn().mockResolvedValue(null),
      groupBy: vi.fn().mockResolvedValue([]),
    },
    creditReservation: {
      groupBy: vi.fn().mockResolvedValue([]),
    },
  },
}));

describe("/api/internal/metrics", () => {
  it("returns 401 Unauthorized when no token provided", async () => {
    const req = new Request("http://localhost:3000/api/internal/metrics", {
      method: "GET",
      headers: {},
    });

    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("returns 401 Unauthorized with invalid token", async () => {
    const req = new Request("http://localhost:3000/api/internal/metrics", {
      method: "GET",
      headers: {
        Authorization: "Bearer invalid-token",
      },
    });

    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("returns 401 with malformed authorization header", async () => {
    const req = new Request("http://localhost:3000/api/internal/metrics", {
      method: "GET",
      headers: {
        Authorization: "InvalidScheme token",
      },
    });

    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("returns Prometheus metrics with valid token", async () => {
    // Set environment variable for this test
    const originalSecret = process.env.METRICS_SECRET;
    process.env.METRICS_SECRET = "test-secret-key";

    try {
      const req = new Request("http://localhost:3000/api/internal/metrics", {
        method: "GET",
        headers: {
          Authorization: "Bearer test-secret-key",
        },
      });

      const res = await GET(req);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/plain");
      expect(res.headers.get("Cache-Control")).toContain("no-store");

      const text = await res.text();
      expect(text).toContain("queue_depth");
      expect(text).toContain("# HELP");
      expect(text).toContain("# TYPE");
    } finally {
      process.env.METRICS_SECRET = originalSecret;
    }
  });

  it("does not expose customer PII in metrics", async () => {
    process.env.METRICS_SECRET = "test-secret";

    try {
      const req = new Request("http://localhost:3000/api/internal/metrics", {
        method: "GET",
        headers: {
          Authorization: "Bearer test-secret",
        },
      });

      const res = await GET(req);
      const text = await res.text();

      // Verify PII is not exposed
      expect(text).not.toContain("@");
      expect(text).not.toContain("user-");
      expect(text).not.toContain("customer");
    } finally {
      process.env.METRICS_SECRET = undefined;
    }
  });

  it("sets no-cache headers", async () => {
    process.env.METRICS_SECRET = "test-secret";

    try {
      const req = new Request("http://localhost:3000/api/internal/metrics", {
        method: "GET",
        headers: {
          Authorization: "Bearer test-secret",
        },
      });

      const res = await GET(req);
      expect(res.headers.get("Cache-Control")).toContain("no-cache");
      expect(res.headers.get("Cache-Control")).toContain("no-store");
      expect(res.headers.get("Pragma")).toBe("no-cache");
    } finally {
      process.env.METRICS_SECRET = undefined;
    }
  });
});
