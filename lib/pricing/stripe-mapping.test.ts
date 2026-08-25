import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getCreditPackByPriceId,
  getCreditPackPriceId,
  getSeatAddonPriceId,
  getV2PlanByPriceId,
  getV2PlanPriceMapping,
  getV2PriceId,
} from "./stripe-mapping";

const ENV_KEYS = [
  "STRIPE_PRICE_HOBBY",
  "STRIPE_PRICE_CREATOR",
  "STRIPE_PRICE_BUSINESS",
  "STRIPE_PRICE_V2_CREDIT_PACK_100",
  "STRIPE_PRICE_V2_SEAT_ADDON",
];

beforeEach(() => ENV_KEYS.forEach((key) => delete process.env[key]));
afterEach(() => ENV_KEYS.forEach((key) => delete process.env[key]));

describe("canonical plan Stripe mapping", () => {
  it("round-trips a configured monthly price and has no invented annual price", () => {
    process.env.STRIPE_PRICE_CREATOR = "price_creator";

    expect(getV2PriceId("creator", "monthly")).toBe("price_creator");
    expect(getV2PriceId("creator", "annual")).toBeUndefined();
    expect(getV2PlanByPriceId("price_creator")).toEqual({ planId: "creator", interval: "monthly" });
  });

  it("returns undefined for an unrecognized price id", () => {
    expect(getV2PlanByPriceId("price_unknown")).toBeUndefined();
  });

  it("lists the three supported paid plan ids for compatibility", () => {
    expect(getV2PlanPriceMapping().map((plan) => plan.planId)).toEqual(["hobby", "creator", "business"]);
  });
});

describe("future add-on mappings", () => {
  it("resolves a configured pack price id and back", () => {
    process.env.STRIPE_PRICE_V2_CREDIT_PACK_100 = "price_pack_100";
    expect(getCreditPackPriceId("pack_100")).toBe("price_pack_100");
    expect(getCreditPackByPriceId("price_pack_100")).toBe("pack_100");
  });

  it("reads the seat add-on price id lazily", () => {
    process.env.STRIPE_PRICE_V2_SEAT_ADDON = "price_seat";
    expect(getSeatAddonPriceId()).toBe("price_seat");
  });
});
