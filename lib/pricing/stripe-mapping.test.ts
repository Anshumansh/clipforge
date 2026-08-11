import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getV2PlanPriceMapping,
  getV2PriceId,
  getV2PlanByPriceId,
  getCreditPackPriceId,
  getCreditPackByPriceId,
  getSeatAddonPriceId,
} from "./stripe-mapping";

const ENV_KEYS = [
  "STRIPE_PRICE_V2_STARTER_MONTHLY",
  "STRIPE_PRICE_V2_STARTER_ANNUAL",
  "STRIPE_PRICE_V2_CREATOR_MONTHLY",
  "STRIPE_PRICE_V2_CREATOR_ANNUAL",
  "STRIPE_PRICE_V2_CREDIT_PACK_100",
  "STRIPE_PRICE_V2_SEAT_ADDON",
];

beforeEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});
afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

describe("getV2PriceId / getV2PlanByPriceId", () => {
  it("round-trips a configured plan+interval to its price id and back", () => {
    process.env.STRIPE_PRICE_V2_STARTER_MONTHLY = "price_starter_m";
    process.env.STRIPE_PRICE_V2_STARTER_ANNUAL = "price_starter_a";

    expect(getV2PriceId("starter", "monthly")).toBe("price_starter_m");
    expect(getV2PriceId("starter", "annual")).toBe("price_starter_a");
    expect(getV2PlanByPriceId("price_starter_m")).toEqual({ planId: "starter", interval: "monthly" });
    expect(getV2PlanByPriceId("price_starter_a")).toEqual({ planId: "starter", interval: "annual" });
  });

  it("returns undefined for an unrecognized price id", () => {
    expect(getV2PlanByPriceId("price_unknown")).toBeUndefined();
  });
});

describe("getV2PlanPriceMapping", () => {
  it("lists all four paid plans (never Free, which has no Stripe price)", () => {
    const mapping = getV2PlanPriceMapping();
    expect(mapping.map((p) => p.planId).sort()).toEqual(["business", "creator", "pro", "starter"]);
  });
});

describe("credit pack mapping", () => {
  it("resolves a configured pack price id and back", () => {
    process.env.STRIPE_PRICE_V2_CREDIT_PACK_100 = "price_pack_100";
    expect(getCreditPackPriceId("pack_100")).toBe("price_pack_100");
    expect(getCreditPackByPriceId("price_pack_100")).toBe("pack_100");
  });
});

describe("getSeatAddonPriceId", () => {
  it("reads the seat add-on price id from env", () => {
    process.env.STRIPE_PRICE_V2_SEAT_ADDON = "price_seat";
    expect(getSeatAddonPriceId()).toBe("price_seat");
  });
});
