/**
 * Compatibility wrappers for Stripe mapping consumers. Plan prices now come
 * from the canonical catalogue and the production `STRIPE_PRICE_*` env keys.
 * Annual subscriptions and add-ons are not sold by the current checkout.
 */
import {
  getPlanConfigByPriceId,
  getStripePriceId,
  type PaidPlanId,
  type StandardPlanId,
} from "@/lib/pricing/plan-config";

export type BillingInterval = "monthly" | "annual";

export interface PlanPriceMapping {
  planId: StandardPlanId;
  monthlyPriceId: string | undefined;
  annualPriceId: string | undefined;
}

const PAID_PLAN_IDS: PaidPlanId[] = ["hobby", "creator", "business"];

export function getV2PlanPriceMapping(): PlanPriceMapping[] {
  return PAID_PLAN_IDS.map((planId) => ({
    planId,
    monthlyPriceId: getStripePriceId(planId),
    annualPriceId: undefined,
  }));
}

export function getV2PriceId(planId: PaidPlanId, interval: BillingInterval): string | undefined {
  return interval === "monthly" ? getStripePriceId(planId) : undefined;
}

export function getV2PlanByPriceId(
  priceId: string
): { planId: StandardPlanId; interval: BillingInterval } | undefined {
  const plan = getPlanConfigByPriceId(priceId);
  return plan && plan.planId !== "free" ? { planId: plan.planId, interval: "monthly" } : undefined;
}

export type CreditPackId = "pack_100" | "pack_500" | "pack_1500" | "pack_5000";

export const CREDIT_PACK_SIZES: Record<CreditPackId, number> = {
  pack_100: 100,
  pack_500: 500,
  pack_1500: 1500,
  pack_5000: 5000,
};

/** Add-ons are not exposed by checkout yet. These helpers remain for the
 * owner-gated future implementation and read values lazily. */
export function getCreditPackPriceId(packId: CreditPackId): string | undefined {
  return process.env[`STRIPE_PRICE_V2_CREDIT_PACK_${CREDIT_PACK_SIZES[packId]}`];
}

export function getCreditPackByPriceId(priceId: string): CreditPackId | undefined {
  return (Object.keys(CREDIT_PACK_SIZES) as CreditPackId[]).find((packId) => getCreditPackPriceId(packId) === priceId);
}

export function getSeatAddonPriceId(): string | undefined {
  return process.env.STRIPE_PRICE_V2_SEAT_ADDON;
}
