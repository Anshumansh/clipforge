import { describe, it, expect } from "vitest";
import {
  contributionMargin,
  maxSafeCostPerCredit,
  classifyPlanMargin,
  isJobAtLoss,
  isRetryRateExcessive,
  isCustomerCostExcessive,
  isDailySpendCapReached,
  MARGIN_WARNING_THRESHOLD,
  MARGIN_CRITICAL_THRESHOLD,
} from "./margin";

describe("contributionMargin", () => {
  it("matches the brief's formula exactly", () => {
    const margin = contributionMargin({
      netRevenueUsd: 100,
      aiCostUsd: 5,
      transcriptionCostUsd: 2,
      ttsCostUsd: 3,
      renderingCostUsd: 4,
      storageEgressCostUsd: 1,
      stripeFeesUsd: 3,
      refundsChargebacksUsd: 2,
      otherDirectCostsUsd: 0,
    });
    // 100 - (5+2+3+4+1+3+2) = 80 -> 80/100 = 0.8
    expect(margin).toBeCloseTo(0.8);
  });

  it("returns 0 for non-positive revenue rather than dividing by zero", () => {
    expect(
      contributionMargin({
        netRevenueUsd: 0,
        aiCostUsd: 1,
        transcriptionCostUsd: 0,
        ttsCostUsd: 0,
        renderingCostUsd: 0,
        storageEgressCostUsd: 0,
        stripeFeesUsd: 0,
        refundsChargebacksUsd: 0,
        otherDirectCostsUsd: 0,
      })
    ).toBe(0);
  });

  it("can go negative when costs exceed revenue (a real loss-making job)", () => {
    const margin = contributionMargin({
      netRevenueUsd: 10,
      aiCostUsd: 8,
      transcriptionCostUsd: 5,
      ttsCostUsd: 0,
      renderingCostUsd: 0,
      storageEgressCostUsd: 0,
      stripeFeesUsd: 0,
      refundsChargebacksUsd: 0,
      otherDirectCostsUsd: 0,
    });
    expect(margin).toBeLessThan(0);
  });
});

describe("maxSafeCostPerCredit", () => {
  it("matches the brief's formula: net plan revenue * 30% / included credits", () => {
    // Starter: $15/mo, 250 credits -> 15 * 0.3 / 250 = 0.018
    expect(maxSafeCostPerCredit(15, 250)).toBeCloseTo(0.018);
  });

  it("throws for non-positive included credits", () => {
    expect(() => maxSafeCostPerCredit(15, 0)).toThrow(RangeError);
  });
});

describe("classifyPlanMargin", () => {
  it("classifies at and around the exact thresholds", () => {
    expect(classifyPlanMargin(0.75)).toBe("ok");
    expect(classifyPlanMargin(MARGIN_WARNING_THRESHOLD)).toBe("ok"); // exactly 70% is not yet "below"
    expect(classifyPlanMargin(0.69)).toBe("warning");
    expect(classifyPlanMargin(MARGIN_CRITICAL_THRESHOLD)).toBe("warning"); // exactly 50% is not yet "critical"
    expect(classifyPlanMargin(0.49)).toBe("critical");
    expect(classifyPlanMargin(-0.1)).toBe("critical");
  });
});

describe("isJobAtLoss", () => {
  it("flags a job whose cost exceeds its allocated revenue", () => {
    expect(isJobAtLoss(0.5, 0.3)).toBe(true);
    expect(isJobAtLoss(0.2, 0.3)).toBe(false);
    expect(isJobAtLoss(0.3, 0.3)).toBe(false); // exactly equal is not "over"
  });
});

describe("isRetryRateExcessive", () => {
  it("flags retries exceeding 10% of production cost", () => {
    expect(isRetryRateExcessive(11, 100)).toBe(true);
    expect(isRetryRateExcessive(10, 100)).toBe(false);
    expect(isRetryRateExcessive(5, 100)).toBe(false);
  });

  it("never flags when there's no production cost to compare against", () => {
    expect(isRetryRateExcessive(5, 0)).toBe(false);
  });
});

describe("isCustomerCostExcessive", () => {
  it("flags a customer costing more than 30% of their net subscription revenue", () => {
    expect(isCustomerCostExcessive(31, 100)).toBe(true);
    expect(isCustomerCostExcessive(30, 100)).toBe(false);
  });

  it("flags any positive cost against zero revenue (e.g. a free-tier abuse case)", () => {
    expect(isCustomerCostExcessive(0.01, 0)).toBe(true);
    expect(isCustomerCostExcessive(0, 0)).toBe(false);
  });
});

describe("isDailySpendCapReached", () => {
  it("flags at and beyond the cap", () => {
    expect(isDailySpendCapReached({ spentTodayUsd: 100, dailyCapUsd: 100 })).toBe(true);
    expect(isDailySpendCapReached({ spentTodayUsd: 99.99, dailyCapUsd: 100 })).toBe(false);
  });
});
