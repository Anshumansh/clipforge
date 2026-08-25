import { describe, it, expect, vi, beforeEach } from "vitest";

const userCount = vi.fn();
const userGroupBy = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      count: (...a: unknown[]) => userCount(...a),
      groupBy: (...a: unknown[]) => userGroupBy(...a),
    },
  },
}));

vi.mock("@/lib/plans", () => ({
  getPlanById: (id: string) =>
    ({
      hobby: { id: "hobby", priceLabel: "$19.99/mo", monthlyCredits: 300 },
      creator: { id: "creator", priceLabel: "$26.88/mo", monthlyCredits: 600 },
      business: { id: "business", priceLabel: "$44.99/mo", monthlyCredits: 2500 },
    })[id],
}));

const { generateMigrationImpactReport } = await import("./migration-report");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("generateMigrationImpactReport", () => {
  it("never reports a cost-side figure -- costDataAvailable is always false", async () => {
    userCount.mockResolvedValueOnce(12).mockResolvedValueOnce(0).mockResolvedValueOnce(0);
    userGroupBy.mockResolvedValue([{ plan: "free", _count: { plan: 12 } }]);

    const report = await generateMigrationImpactReport();

    expect(report.costDataAvailable).toBe(false);
    expect(report.lossMakingAccountIds).toEqual([]);
  });

  it("flags the zero-paid-subscriber case with an explicit grandfathering note", async () => {
    userCount.mockResolvedValueOnce(12).mockResolvedValueOnce(0).mockResolvedValueOnce(0);
    userGroupBy.mockResolvedValue([{ plan: "free", _count: { plan: 12 } }]);

    const report = await generateMigrationImpactReport();

    expect(report.activeStripeSubscriptions).toBe(0);
    expect(report.notes.some((n) => n.includes("no paid customer base to migrate"))).toBe(true);
  });

  it("maps recognized plans to the canonical catalogue without silently changing terms", async () => {
    userCount.mockResolvedValueOnce(20).mockResolvedValueOnce(5).mockResolvedValueOnce(0);
    userGroupBy.mockResolvedValue([
      { plan: "free", _count: { plan: 15 } },
      { plan: "hobby", _count: { plan: 3 } },
      { plan: "creator", _count: { plan: 2 } },
    ]);

    const report = await generateMigrationImpactReport();

    const hobbyRow = report.byLegacyPlan.find((r) => r.legacyPlanId === "hobby");
    expect(hobbyRow?.suggestedNewPlanId).toBe("hobby");
    expect(hobbyRow?.legacyMonthlyPriceUsd).toBe(19.99);
    expect(hobbyRow?.newMonthlyPriceUsd).toBe(19.99);
    expect(hobbyRow?.priceDeltaUsd).toBe(0);
    expect(hobbyRow?.creditsDeltaAtNewPrice).toBe(0);

    const creatorRow = report.byLegacyPlan.find((r) => r.legacyPlanId === "creator");
    expect(creatorRow?.suggestedNewPlanId).toBe("creator");
    expect(creatorRow?.priceDeltaUsd).toBe(0);
  });

  it("treats the free plan as $0 with 50 legacy credits (the current User.credits default)", async () => {
    userCount.mockResolvedValueOnce(12).mockResolvedValueOnce(0).mockResolvedValueOnce(0);
    userGroupBy.mockResolvedValue([{ plan: "free", _count: { plan: 12 } }]);

    const report = await generateMigrationImpactReport();

    const freeRow = report.byLegacyPlan[0];
    expect(freeRow.legacyMonthlyPriceUsd).toBe(0);
    expect(freeRow.legacyMonthlyCredits).toBe(50);
    expect(freeRow.newMonthlyCredits).toBe(50);
  });
});
