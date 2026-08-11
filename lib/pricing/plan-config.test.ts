import { describe, it, expect } from "vitest";
import { PLAN_CONFIGS } from "./plan-config";

describe("PLAN_CONFIGS", () => {
  it("matches every price and credit figure in the brief exactly", () => {
    expect(PLAN_CONFIGS.free.monthlyPriceUsd).toBe(0);
    expect(PLAN_CONFIGS.free.monthlyCredits).toBe(20);
    expect(PLAN_CONFIGS.free.maxDurationSec).toBe(30);

    expect(PLAN_CONFIGS.starter.monthlyPriceUsd).toBe(15);
    expect(PLAN_CONFIGS.starter.annualPriceUsd).toBe(144);
    expect(PLAN_CONFIGS.starter.monthlyCredits).toBe(250);

    expect(PLAN_CONFIGS.creator.monthlyPriceUsd).toBe(29);
    expect(PLAN_CONFIGS.creator.annualPriceUsd).toBe(278);
    expect(PLAN_CONFIGS.creator.monthlyCredits).toBe(600);

    expect(PLAN_CONFIGS.pro.monthlyPriceUsd).toBe(59);
    expect(PLAN_CONFIGS.pro.annualPriceUsd).toBe(566);
    expect(PLAN_CONFIGS.pro.monthlyCredits).toBe(1500);
    expect(PLAN_CONFIGS.pro.seatsIncluded).toBe(2);

    expect(PLAN_CONFIGS.business.monthlyPriceUsd).toBe(119);
    expect(PLAN_CONFIGS.business.annualPriceUsd).toBe(1142);
    expect(PLAN_CONFIGS.business.monthlyCredits).toBe(3500);
    expect(PLAN_CONFIGS.business.seatsIncluded).toBe(5);
  });

  it("keeps every annual price within $1 of a 20% discount vs. 12x monthly (the brief's own figures round down to whole dollars, e.g. Creator: $348 * 0.8 = $278.40 -> $278)", () => {
    for (const plan of Object.values(PLAN_CONFIGS)) {
      if (plan.annualPriceUsd === null) continue;
      const fullPrice = plan.monthlyPriceUsd * 12;
      const twentyPercentOffPrice = fullPrice * 0.8;
      expect(plan.annualPriceUsd).toBeGreaterThan(twentyPercentOffPrice - 1);
      expect(plan.annualPriceUsd).toBeLessThanOrEqual(twentyPercentOffPrice);
    }
  });

  it("gates repurpose and UGC workflows correctly per the brief (Free/Starter lack them, Creator+ has them)", () => {
    expect(PLAN_CONFIGS.free.workflows).toEqual({ script: true, repurpose: false, ugc: false });
    expect(PLAN_CONFIGS.starter.workflows).toEqual({ script: true, repurpose: false, ugc: false });
    expect(PLAN_CONFIGS.creator.workflows).toEqual({ script: true, repurpose: true, ugc: true });
    expect(PLAN_CONFIGS.pro.workflows).toEqual({ script: true, repurpose: true, ugc: true });
    expect(PLAN_CONFIGS.business.workflows).toEqual({ script: true, repurpose: true, ugc: true });
  });

  it("gates voice cloning and 4K to Pro and Business only", () => {
    for (const id of ["free", "starter", "creator"] as const) {
      expect(PLAN_CONFIGS[id].voiceCloning).toBe(false);
      expect(PLAN_CONFIGS[id].maxResolution).not.toBe("4k");
    }
    expect(PLAN_CONFIGS.pro.voiceCloning).toBe(true);
    expect(PLAN_CONFIGS.pro.maxResolution).toBe("4k");
    expect(PLAN_CONFIGS.business.voiceCloning).toBe(true);
    expect(PLAN_CONFIGS.business.maxResolution).toBe("4k");
  });
});
