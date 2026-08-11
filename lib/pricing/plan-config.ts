/**
 * Canonical plan definitions (pricing overhaul brief, section 1 + 2) --
 * every number here is copied verbatim from PRICING_OVERHAUL_BRIEF.md.
 * This is the "2026-08-v1" version generation; it's created as PlanVersion
 * rows (see lib/pricing/plan-versions.ts's seedPlanVersions) rather than
 * left as bare constants, so a future price change creates a NEW version
 * instead of mutating this one out from under existing subscribers (brief
 * section 11).
 *
 * Deliberately has NO server-only imports (no `@/lib/db`) -- this module is
 * imported by the client component components/pricing-v2.tsx for
 * PLAN_CONFIGS, and Next.js bundles a module's ENTIRE import graph into
 * client JS the moment any client component imports anything from it.
 * Pulling in Prisma here would ship "PrismaClient is unable to run in this
 * browser environment" to every visitor. DB-backed helpers that need these
 * types live in lib/pricing/plan-versions.ts instead.
 *
 * Nothing reads from this module for real charging yet -- see
 * lib/pricing/flags.ts's isPricingV2Enabled(). Until that's on, every user
 * resolves through the legacy lib/plans.ts hobby/creator/business
 * definitions exactly as today.
 */

export type StandardPlanId = "free" | "starter" | "creator" | "pro" | "business";

export interface PlanFeatureConfig {
  planId: StandardPlanId;
  displayName: string;
  monthlyPriceUsd: number;
  annualPriceUsd: number | null; // null for Free (no paid billing)
  monthlyCredits: number;
  /** Free plan's 20 credits are a one-time grant on verification, not a
   * recurring monthly grant -- this flag is what tells the renewal job
   * NOT to re-grant Free accounts every cycle. */
  oneTimeCreditsOnly: boolean;
  maxDurationSec: number | null; // null = no plan-specific cap beyond the credit calculator's own 90s ceiling
  watermark: boolean;
  maxResolution: "720p" | "1080p" | "4k";
  workflows: { script: boolean; repurpose: boolean; ugc: boolean };
  voiceCloning: boolean;
  brandPresetLimit: number;
  queue: "standard" | "priority" | "premium" | "highest";
  retentionDays: number | null; // null = not specified in the brief for this plan
  seatsIncluded: number;
  apiAccess: "none" | "limited" | "higher_limited";
  socialPublishing: boolean; // still additionally gated by lib/social/platforms.ts's per-platform verified-live status
}

export const PLAN_CONFIGS: Record<StandardPlanId, PlanFeatureConfig> = {
  free: {
    planId: "free",
    displayName: "Free",
    monthlyPriceUsd: 0,
    annualPriceUsd: null,
    monthlyCredits: 20,
    oneTimeCreditsOnly: true,
    maxDurationSec: 30,
    watermark: true,
    maxResolution: "720p",
    workflows: { script: true, repurpose: false, ugc: false },
    voiceCloning: false,
    brandPresetLimit: 0,
    queue: "standard",
    retentionDays: null,
    seatsIncluded: 1,
    apiAccess: "none",
    socialPublishing: false,
  },
  starter: {
    planId: "starter",
    displayName: "Starter",
    monthlyPriceUsd: 15,
    annualPriceUsd: 144,
    monthlyCredits: 250,
    oneTimeCreditsOnly: false,
    maxDurationSec: null,
    watermark: false,
    maxResolution: "1080p",
    workflows: { script: true, repurpose: false, ugc: false },
    voiceCloning: false,
    brandPresetLimit: 1,
    queue: "standard",
    retentionDays: null,
    seatsIncluded: 1,
    apiAccess: "none",
    socialPublishing: false,
  },
  creator: {
    planId: "creator",
    displayName: "Creator",
    monthlyPriceUsd: 29,
    annualPriceUsd: 278,
    monthlyCredits: 600,
    oneTimeCreditsOnly: false,
    maxDurationSec: null,
    watermark: false,
    maxResolution: "1080p",
    workflows: { script: true, repurpose: true, ugc: true },
    voiceCloning: false,
    brandPresetLimit: 2,
    queue: "priority",
    retentionDays: 30,
    seatsIncluded: 1,
    apiAccess: "none",
    socialPublishing: true,
  },
  pro: {
    planId: "pro",
    displayName: "Pro",
    monthlyPriceUsd: 59,
    annualPriceUsd: 566,
    monthlyCredits: 1500,
    oneTimeCreditsOnly: false,
    maxDurationSec: null,
    watermark: false,
    maxResolution: "4k",
    workflows: { script: true, repurpose: true, ugc: true },
    voiceCloning: true,
    brandPresetLimit: 5,
    queue: "premium",
    retentionDays: 60,
    seatsIncluded: 2,
    apiAccess: "limited",
    socialPublishing: true,
  },
  business: {
    planId: "business",
    displayName: "Business",
    monthlyPriceUsd: 119,
    annualPriceUsd: 1142,
    monthlyCredits: 3500,
    oneTimeCreditsOnly: false,
    maxDurationSec: null,
    watermark: false,
    maxResolution: "4k",
    workflows: { script: true, repurpose: true, ugc: true },
    voiceCloning: true,
    brandPresetLimit: 10,
    queue: "highest",
    retentionDays: 90,
    seatsIncluded: 5,
    apiAccess: "higher_limited",
    socialPublishing: true,
  },
};

export const CURRENT_PLAN_VERSION_LABEL = "2026-08-v1";
