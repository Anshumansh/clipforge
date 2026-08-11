/**
 * Stripe price mapping for the pricing overhaul's new plans (brief section
 * 9). TEST MODE ONLY -- these price IDs were provisioned in Stripe test
 * mode (see STRIPE_PRODUCT_MAPPING.md for the exact products/prices and how
 * they were created). Production equivalents do not exist and must not be
 * created without explicit owner approval, per the brief's staged rollout.
 *
 * Additive alongside the legacy lib/plans.ts, which the live checkout route
 * still uses exclusively until PRICING_V2_ENABLED flips on.
 */
import type { StandardPlanId } from "@/lib/pricing/plan-config";

export type BillingInterval = "monthly" | "annual";

export interface PlanPriceMapping {
  planId: StandardPlanId;
  monthlyPriceId: string | undefined;
  annualPriceId: string | undefined;
}

const PAID_PLAN_IDS: Exclude<StandardPlanId, "free">[] = ["starter", "creator", "pro", "business"];

export function getV2PlanPriceMapping(): PlanPriceMapping[] {
  return PAID_PLAN_IDS.map((planId) => ({
    planId,
    monthlyPriceId: process.env[`STRIPE_PRICE_V2_${planId.toUpperCase()}_MONTHLY`],
    annualPriceId: process.env[`STRIPE_PRICE_V2_${planId.toUpperCase()}_ANNUAL`],
  }));
}

export function getV2PriceId(planId: Exclude<StandardPlanId, "free">, interval: BillingInterval): string | undefined {
  const envKey = `STRIPE_PRICE_V2_${planId.toUpperCase()}_${interval === "monthly" ? "MONTHLY" : "ANNUAL"}`;
  return process.env[envKey];
}

export function getV2PlanByPriceId(priceId: string): { planId: StandardPlanId; interval: BillingInterval } | undefined {
  for (const planId of PAID_PLAN_IDS) {
    if (getV2PriceId(planId, "monthly") === priceId) return { planId, interval: "monthly" };
    if (getV2PriceId(planId, "annual") === priceId) return { planId, interval: "annual" };
  }
  return undefined;
}

export type CreditPackId = "pack_100" | "pack_500" | "pack_1500" | "pack_5000";

export const CREDIT_PACK_SIZES: Record<CreditPackId, number> = {
  pack_100: 100,
  pack_500: 500,
  pack_1500: 1500,
  pack_5000: 5000,
};

/** pack_5000 is restricted to owner-approved Business/Enterprise accounts
 * per the brief -- callers must check plan/approval before offering it,
 * this mapping alone doesn't enforce that restriction. */
export function getCreditPackPriceId(packId: CreditPackId): string | undefined {
  return process.env[`STRIPE_PRICE_V2_CREDIT_PACK_${CREDIT_PACK_SIZES[packId]}`];
}

export function getCreditPackByPriceId(priceId: string): CreditPackId | undefined {
  return (Object.keys(CREDIT_PACK_SIZES) as CreditPackId[]).find((packId) => getCreditPackPriceId(packId) === priceId);
}

export function getSeatAddonPriceId(): string | undefined {
  return process.env.STRIPE_PRICE_V2_SEAT_ADDON;
}
