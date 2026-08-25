/**
 * Canonical Clipforge plan catalogue.
 *
 * Every customer-facing price, Stripe mapping and feature gate must resolve
 * through this file. The previous codebase had a live three-plan catalogue
 * in `lib/plans.ts` and a second, disabled five-plan preview in this module.
 * Those catalogues disagreed on price, credits and entitlements.
 *
 * This catalogue preserves the terms production currently charges. Hobby
 * remains supported for existing subscribers and admin comps, but is not
 * offered to new customers; the simpler public choice is Free, Creator or
 * Business. A future price change must be introduced as a new version after
 * real JobCostRecord data and matching Stripe Prices exist.
 */

export type StandardPlanId = "free" | "hobby" | "creator" | "business";
export type PaidPlanId = Exclude<StandardPlanId, "free">;
export type PurchasablePlanId = "creator" | "business";

export interface PlanFeatureConfig {
  planId: StandardPlanId;
  displayName: string;
  monthlyPriceUsd: number;
  annualPriceUsd: number | null;
  monthlyCredits: number;
  oneTimeCreditsOnly: boolean;
  maxDurationSec: number | null;
  watermark: boolean;
  maxResolution: "1080p";
  workflows: { script: boolean; repurpose: boolean; ugc: boolean };
  voiceCloning: boolean;
  brandPresetLimit: number;
  queue: "standard" | "priority" | "highest";
  retentionDays: number | null;
  seatsIncluded: number;
  apiAccess: "none" | "higher_limited";
  socialPublishing: boolean;
  multiFormatExport: boolean;
  canCreateWorkspace: boolean;
  public: boolean;
  purchasable: boolean;
  highlighted: boolean;
  description: string;
  cta: string;
  stripePriceEnvKey: string | null;
  marketingFeatures: readonly string[];
}

export const PLAN_CONFIGS: Record<StandardPlanId, PlanFeatureConfig> = {
  free: {
    planId: "free",
    displayName: "Free",
    monthlyPriceUsd: 0,
    annualPriceUsd: null,
    monthlyCredits: 50,
    oneTimeCreditsOnly: true,
    maxDurationSec: 30,
    watermark: true,
    maxResolution: "1080p",
    workflows: { script: true, repurpose: false, ugc: false },
    voiceCloning: false,
    brandPresetLimit: 0,
    queue: "standard",
    retentionDays: null,
    seatsIncluded: 1,
    apiAccess: "none",
    socialPublishing: false,
    multiFormatExport: false,
    canCreateWorkspace: false,
    public: true,
    purchasable: false,
    highlighted: false,
    description: "Create your first short and see the complete workflow.",
    cta: "Create free",
    stripePriceEnvKey: null,
    marketingFeatures: [
      "50 included credits",
      "Script-to-video workflow",
      "Watermarked HD exports",
      "No credit card required",
    ],
  },
  hobby: {
    planId: "hobby",
    displayName: "Hobby (legacy)",
    monthlyPriceUsd: 19.99,
    annualPriceUsd: null,
    monthlyCredits: 300,
    oneTimeCreditsOnly: false,
    maxDurationSec: null,
    watermark: false,
    maxResolution: "1080p",
    workflows: { script: true, repurpose: true, ugc: false },
    voiceCloning: false,
    brandPresetLimit: 0,
    queue: "standard",
    retentionDays: null,
    seatsIncluded: 1,
    apiAccess: "none",
    socialPublishing: true,
    multiFormatExport: false,
    canCreateWorkspace: false,
    public: false,
    purchasable: false,
    highlighted: false,
    description: "Legacy plan retained for existing subscribers.",
    cta: "Legacy plan",
    stripePriceEnvKey: "STRIPE_PRICE_HOBBY",
    marketingFeatures: ["300 credits per month", "Script and repurpose workflows", "1080p exports"],
  },
  creator: {
    planId: "creator",
    displayName: "Creator",
    monthlyPriceUsd: 26.88,
    annualPriceUsd: null,
    monthlyCredits: 600,
    oneTimeCreditsOnly: false,
    maxDurationSec: null,
    watermark: false,
    maxResolution: "1080p",
    workflows: { script: true, repurpose: true, ugc: true },
    voiceCloning: false,
    brandPresetLimit: 0,
    queue: "priority",
    retentionDays: null,
    seatsIncluded: 1,
    apiAccess: "none",
    socialPublishing: true,
    multiFormatExport: false,
    canCreateWorkspace: false,
    public: true,
    purchasable: true,
    highlighted: true,
    description: "For creators who publish consistently across formats.",
    cta: "Choose Creator",
    stripePriceEnvKey: "STRIPE_PRICE_CREATOR",
    marketingFeatures: [
      "600 credits per month",
      "Idea, repurpose and UGC workflows",
      "1080p exports without a watermark",
      "Priority render queue",
      "Social publishing",
    ],
  },
  business: {
    planId: "business",
    displayName: "Business",
    monthlyPriceUsd: 44.99,
    annualPriceUsd: null,
    monthlyCredits: 2500,
    oneTimeCreditsOnly: false,
    maxDurationSec: null,
    watermark: false,
    maxResolution: "1080p",
    workflows: { script: true, repurpose: true, ugc: true },
    voiceCloning: true,
    brandPresetLimit: 1,
    queue: "highest",
    retentionDays: null,
    seatsIncluded: 5,
    apiAccess: "higher_limited",
    socialPublishing: true,
    multiFormatExport: true,
    canCreateWorkspace: true,
    public: true,
    purchasable: true,
    highlighted: false,
    description: "For brands and small teams producing content at scale.",
    cta: "Choose Business",
    stripePriceEnvKey: "STRIPE_PRICE_BUSINESS",
    marketingFeatures: [
      "2,500 credits per month",
      "All three generation workflows",
      "Vertical, square and landscape formats",
      "Brand kit and voice cloning",
      "Team workspace and API access",
      "Highest-priority render queue",
    ],
  },
};

export const CURRENT_PLAN_VERSION_LABEL = "2026-08-live-v1";

export function getPlanConfig(id: string): PlanFeatureConfig | undefined {
  return PLAN_CONFIGS[id as StandardPlanId];
}

export function getPublicPlanConfigs(): PlanFeatureConfig[] {
  return Object.values(PLAN_CONFIGS).filter((plan) => plan.public);
}

export function getPurchasablePlanConfigs(): PlanFeatureConfig[] {
  return Object.values(PLAN_CONFIGS).filter((plan) => plan.purchasable);
}

export function isPurchasablePlanId(id: string): id is PurchasablePlanId {
  return id === "creator" || id === "business";
}

/** Read at request time, not module load time, so rotated Railway/VPS values
 * are picked up after a process restart and tests can safely isolate env. */
export function getStripePriceId(planId: string): string | undefined {
  const key = getPlanConfig(planId)?.stripePriceEnvKey;
  return key ? process.env[key] : undefined;
}

export function getPlanConfigByPriceId(priceId: string): PlanFeatureConfig | undefined {
  return Object.values(PLAN_CONFIGS).find((plan) => getStripePriceId(plan.planId) === priceId);
}
