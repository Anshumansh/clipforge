import { describe, it, expect, vi } from "vitest";
import parsePrometheusTextFormat from "parse-prometheus-text-format";
import { GET } from "./route";
import { db } from "@/lib/db";

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

  // Phase F: the earlier "returns Prometheus metrics" test above only checks
  // that a few expected substrings appear -- it would still pass on output
  // with a malformed label, a missing TYPE line, or any other spec violation
  // that would make a real Prometheus server reject the scrape. This parses
  // the actual response body with parse-prometheus-text-format (a real
  // implementation of the exposition-format grammar, ported from the
  // official Prometheus Python client's own parser) to prove the output is
  // genuinely valid, not just superficially plausible.
  //
  // Note: this validates the exposition-FORMAT the endpoint emits. There is
  // no committed Prometheus scrape config or Grafana dashboard/provisioning
  // anywhere in this repo to validate against `promtool check config` --
  // "monitoring" today is this one endpoint capable of being scraped, not an
  // actually-deployed Prometheus/Grafana stack. See the Phase F summary.
  it("emits genuinely well-formed Prometheus exposition format, not just plausible-looking text", async () => {
    process.env.METRICS_SECRET = "test-secret";
    // Non-empty groupBy results so the label/value lines this test actually
    // validates are present, not just the always-emitted HELP/TYPE headers.
    vi.mocked(db.job.groupBy).mockResolvedValueOnce([
      { status: "queued", _count: 3 },
      { status: "processing", _count: 1 },
    ] as never);
    vi.mocked(db.creditReservation.groupBy).mockResolvedValueOnce([
      { status: "reserved", _count: 2 },
    ] as never);

    try {
      const req = new Request("http://localhost:3000/api/internal/metrics", {
        method: "GET",
        headers: { Authorization: "Bearer test-secret" },
      });

      const res = await GET(req);
      const text = await res.text();

      let parsed: ReturnType<typeof parsePrometheusTextFormat>;
      expect(() => {
        parsed = parsePrometheusTextFormat(text);
      }).not.toThrow();

      const names = parsed!.map((m) => m.name);
      expect(names).toEqual(
        expect.arrayContaining([
          "queue_depth",
          "queue_oldest_job_age_seconds",
          "jobs_by_status",
          "credit_reservations_by_status",
          "credit_inconsistencies_total",
          "metrics_collection_timestamp_seconds",
        ])
      );

      // Every parsed metric must have a real numeric value and a
      // spec-compliant type -- a parser that silently accepted garbage
      // wouldn't prove anything.
      for (const metric of parsed!) {
        expect(["GAUGE", "COUNTER"]).toContain(metric.type);
        expect(metric.metrics.length).toBeGreaterThan(0);
        for (const sample of metric.metrics) {
          expect(Number.isNaN(Number(sample.value))).toBe(false);
        }
      }
    } finally {
      process.env.METRICS_SECRET = undefined;
    }
  });
});
