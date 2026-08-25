/** Compatibility helpers around the single canonical plan catalogue.
 * New code should prefer `lib/pricing/plan-config` directly. */
import {
  PLAN_CONFIGS,
  getPlanConfig,
  getPlanConfigByPriceId,
  getStripePriceId,
  type PaidPlanId,
} from "@/lib/pricing/plan-config";

export interface Plan {
  id: PaidPlanId;
  name: string;
  readonly priceId: string | undefined;
  monthlyCredits: number;
  priceLabel: string;
}

function paidPlan(id: PaidPlanId): Plan {
  const config = PLAN_CONFIGS[id];
  return {
    id,
    name: config.displayName,
    get priceId() {
      return getStripePriceId(id);
    },
    monthlyCredits: config.monthlyCredits,
    priceLabel: `$${config.monthlyPriceUsd.toFixed(2)}/mo`,
  };
}

/** Includes Hobby for existing-subscriber/admin compatibility. New sales
 * are limited by the checkout schema and public catalogue. */
export const PLANS: Plan[] = [paidPlan("hobby"), paidPlan("creator"), paidPlan("business")];

export function getPlanById(id: string): Plan | undefined {
  if (id === "free") return undefined;
  return PLANS.find((plan) => plan.id === id);
}

export function getPlanByPriceId(priceId: string): Plan | undefined {
  const config = getPlanConfigByPriceId(priceId);
  return config && config.planId !== "free" ? getPlanById(config.planId) : undefined;
}

export function canUseVoiceClone(plan: string): boolean {
  return getPlanConfig(plan)?.voiceCloning === true;
}

export function canUseBrandKit(plan: string): boolean {
  return (getPlanConfig(plan)?.brandPresetLimit ?? 0) > 0;
}

export function canUseApiAccess(plan: string): boolean {
  const config = getPlanConfig(plan);
  return config !== undefined && config.apiAccess !== "none";
}

export function canCreateWorkspace(plan: string): boolean {
  return getPlanConfig(plan)?.canCreateWorkspace === true;
}

export function canUseRepurpose(plan: string): boolean {
  return getPlanConfig(plan)?.workflows.repurpose === true;
}

export function canUseUgc(plan: string): boolean {
  return getPlanConfig(plan)?.workflows.ugc === true;
}

export function canUseSocialPublishing(plan: string): boolean {
  return getPlanConfig(plan)?.socialPublishing === true;
}
