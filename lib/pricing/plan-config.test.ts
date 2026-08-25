import { afterEach, describe, expect, it } from "vitest";
import {
  PLAN_CONFIGS,
  getPlanConfigByPriceId,
  getPublicPlanConfigs,
  getPurchasablePlanConfigs,
  getStripePriceId,
} from "./plan-config";

afterEach(() => {
  delete process.env.STRIPE_PRICE_HOBBY;
  delete process.env.STRIPE_PRICE_CREATOR;
  delete process.env.STRIPE_PRICE_BUSINESS;
});

describe("canonical PLAN_CONFIGS", () => {
  it("matches the terms currently charged by the live application", () => {
    expect(PLAN_CONFIGS.free.monthlyPriceUsd).toBe(0);
    expect(PLAN_CONFIGS.free.monthlyCredits).toBe(50);
    expect(PLAN_CONFIGS.hobby.monthlyPriceUsd).toBe(19.99);
    expect(PLAN_CONFIGS.hobby.monthlyCredits).toBe(300);
    expect(PLAN_CONFIGS.creator.monthlyPriceUsd).toBe(26.88);
    expect(PLAN_CONFIGS.creator.monthlyCredits).toBe(600);
    expect(PLAN_CONFIGS.business.monthlyPriceUsd).toBe(44.99);
    expect(PLAN_CONFIGS.business.monthlyCredits).toBe(2500);
  });

  it("offers exactly Free, Creator and Business to new customers", () => {
    expect(getPublicPlanConfigs().map((plan) => plan.planId)).toEqual(["free", "creator", "business"]);
    expect(getPurchasablePlanConfigs().map((plan) => plan.planId)).toEqual(["creator", "business"]);
    expect(PLAN_CONFIGS.hobby.public).toBe(false);
    expect(PLAN_CONFIGS.hobby.purchasable).toBe(false);
  });

  it("keeps existing Hobby functionality while preventing new checkout", () => {
    expect(PLAN_CONFIGS.hobby.workflows).toEqual({ script: true, repurpose: true, ugc: false });
    expect(PLAN_CONFIGS.creator.workflows).toEqual({ script: true, repurpose: true, ugc: true });
    expect(PLAN_CONFIGS.business.workflows).toEqual({ script: true, repurpose: true, ugc: true });
    expect(PLAN_CONFIGS.hobby.socialPublishing).toBe(true);
  });

  it("only promises render capabilities that the current pipeline implements", () => {
    for (const plan of Object.values(PLAN_CONFIGS)) {
      expect(plan.maxResolution).toBe("1080p");
      expect(plan.marketingFeatures.join(" ")).not.toMatch(/4K/i);
    }
    expect(PLAN_CONFIGS.business.multiFormatExport).toBe(true);
  });

  it("reserves expensive and account-level capabilities for Business", () => {
    for (const id of ["free", "hobby", "creator"] as const) {
      expect(PLAN_CONFIGS[id].voiceCloning).toBe(false);
      expect(PLAN_CONFIGS[id].apiAccess).toBe("none");
      expect(PLAN_CONFIGS[id].canCreateWorkspace).toBe(false);
    }
    expect(PLAN_CONFIGS.business.voiceCloning).toBe(true);
    expect(PLAN_CONFIGS.business.apiAccess).toBe("higher_limited");
    expect(PLAN_CONFIGS.business.canCreateWorkspace).toBe(true);
  });

  it("reads Stripe mappings lazily from the canonical env keys", () => {
    expect(getStripePriceId("creator")).toBeUndefined();
    process.env.STRIPE_PRICE_CREATOR = "price_creator";
    expect(getStripePriceId("creator")).toBe("price_creator");
    expect(getPlanConfigByPriceId("price_creator")?.planId).toBe("creator");
  });
});
