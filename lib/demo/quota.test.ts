import { describe, it, expect, vi, beforeEach } from "vitest";

const transactionFn = vi.fn();
vi.mock("@/lib/db", () => ({
  db: { $transaction: (...a: unknown[]) => transactionFn(...a) },
}));

const { checkAndReserveDemoQuota } = await import("@/lib/demo/quota");

describe("checkAndReserveDemoQuota fail-open behavior", () => {
  beforeEach(() => vi.clearAllMocks());

  it("allows the demo through if the database transaction throws (fail open, not fail closed)", async () => {
    transactionFn.mockRejectedValue(new Error("connection refused"));

    const result = await checkAndReserveDemoQuota("1.2.3.4");

    // Deliberate: an infra blip must not hard-down the whole anonymous demo
    // feature. isDemoEnabled() (app/api/demo/generate/route.ts) remains the
    // real kill switch for a deliberate shutoff -- this is only about
    // surviving a transient DB failure gracefully.
    expect(result).toEqual({ allowed: true });
  });
});
