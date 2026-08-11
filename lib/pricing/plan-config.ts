/**
 * Canonical plan definitions (pricing overhaul brief, section 1 + 2) --
 * every number here is copied verbatim from PRICING_OVERHAUL_BRIEF.md.
 * This is the "2026-08-v1" version generation; it's created as PlanVersion
 * rows (see seedPlanVersions below) rather than left as bare constants, so
 * a future price change creates a NEW version instead of mutating this one
 * out from under existing subscribers (brief section 11).
 *
 * Nothing reads from this module for real charging yet -- see
 * lib/pricing/flags.ts's isPricingV2Enabled(). Until that's on, every user
 * resolves through the legacy lib/plans.ts hobby/creator/business
 * definitions exactly as today.
 */
import { db } from "@/lib/db";

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

/** Creates (or updates the still-open) PlanVersion row for every plan in
 * PLAN_CONFIGS. Safe to run repeatedly -- upserts on [planId, versionLabel],
 * so re-running after an edit to PLAN_CONFIGS updates the same open version
 * rather than creating duplicates. Does NOT touch any User row; assigning
 * existing or new accounts to these versions is a separate, explicit step
 * (see CUSTOMER_MIGRATION.md -- owner approval required for existing
 * subscribers). */
export async function seedPlanVersions(): Promise<void> {
  for (const config of Object.values(PLAN_CONFIGS)) {
    await db.planVersion.upsert({
      where: { planId_versionLabel: { planId: config.planId, versionLabel: CURRENT_PLAN_VERSION_LABEL } },
      create: {
        planId: config.planId,
        versionLabel: CURRENT_PLAN_VERSION_LABEL,
        displayName: config.displayName,
        monthlyPriceUsd: config.monthlyPriceUsd,
        annualPriceUsd: config.annualPriceUsd,
        monthlyCredits: config.monthlyCredits,
        configJson: JSON.stringify(config),
      },
      update: {
        displayName: config.displayName,
        monthlyPriceUsd: config.monthlyPriceUsd,
        annualPriceUsd: config.annualPriceUsd,
        monthlyCredits: config.monthlyCredits,
        configJson: JSON.stringify(config),
      },
    });
  }
}

/** Resolves the effective plan config for a user. A non-null
 * User.planVersionId always wins (an explicit, versioned assignment,
 * whether from new-customer signup or an owner-approved migration). A null
 * planVersionId falls back to null -- the caller (lib/pricing/legacy-plan.ts,
 * not written here) is responsible for mapping that to the pre-overhaul
 * hobby/creator/business definitions, since this module's whole purpose is
 * the NEW versioned config, not a compatibility shim for the old one. */
export async function resolvePlanConfig(planVersionId: string | null): Promise<PlanFeatureConfig | null> {
  if (!planVersionId) return null;
  const version = await db.planVersion.findUnique({ where: { id: planVersionId } });
  if (!version) return null;
  return JSON.parse(version.configJson) as PlanFeatureConfig;
}
