/**
 * Server-only DB operations for plan versioning (brief section 8/11).
 * Split from lib/pricing/plan-config.ts specifically so that module can stay
 * safe to import from client components -- this file pulls in Prisma, so
 * only server components / route handlers / server actions should import it.
 */
import { db } from "@/lib/db";
import { PLAN_CONFIGS, CURRENT_PLAN_VERSION_LABEL, type PlanFeatureConfig } from "@/lib/pricing/plan-config";

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
 * planVersionId falls back to null -- the caller is responsible for mapping
 * that to the pre-overhaul hobby/creator/business definitions in
 * lib/plans.ts, since this module's whole purpose is the NEW versioned
 * config, not a compatibility shim for the old one. */
export async function resolvePlanConfig(planVersionId: string | null): Promise<PlanFeatureConfig | null> {
  if (!planVersionId) return null;
  const version = await db.planVersion.findUnique({ where: { id: planVersionId } });
  if (!version) return null;
  return JSON.parse(version.configJson) as PlanFeatureConfig;
}
