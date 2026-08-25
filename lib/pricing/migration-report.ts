/**
 * Existing-subscriber migration impact report (brief section 11). Reads
 * real account data -- never invents a revenue or cost figure. Cost-side
 * comparison (real per-account render cost under the new credit weights)
 * is intentionally left null/unavailable here: it depends on JobCostRecord
 * data that isn't populated yet (cost tracking isn't wired into any job
 * runner in this pass -- see lib/pricing/cost-tracking.ts's own doc
 * comment). Reporting a cost estimate without that data would be exactly
 * the invented number the brief prohibits.
 *
 * This module only reads. It never assigns a User.planVersionId, sends a
 * notice, or changes anyone's plan -- the brief requires explicit owner
 * approval before any of that, and no code path here provides one.
 */
import { db } from "@/lib/db";
import { getPlanById as getLegacyPlanById } from "@/lib/plans";
import { PLAN_CONFIGS } from "@/lib/pricing/plan-config";

export interface LegacyPlanAccountSummary {
  legacyPlanId: string;
  accountCount: number;
  legacyMonthlyPriceUsd: number | null; // null for free (no price) or an unrecognized plan id
  legacyMonthlyCredits: number | null;
  /** The new-structure plan this legacy plan id most directly corresponds
   * to, for comparison purposes only -- not an assignment. The canonical
   * recovery preserves every existing id, so every recognized plan maps to
   * itself and the report detects unintended drift. */
  suggestedNewPlanId: keyof typeof PLAN_CONFIGS | null;
  newMonthlyPriceUsd: number | null;
  newMonthlyCredits: number | null;
  priceDeltaUsd: number | null; // new - old, positive = price increase if migrated
  creditsDeltaAtNewPrice: number | null; // new - old, positive = more credits if migrated
}

const LEGACY_TO_NEW_PLAN_MAP: Record<string, keyof typeof PLAN_CONFIGS | undefined> = {
  free: "free",
  hobby: "hobby",
  creator: "creator",
  business: "business",
};

export interface MigrationImpactReport {
  generatedAt: Date;
  totalAccounts: number;
  activeStripeSubscriptions: number;
  accountsWithBillingIssue: number;
  byLegacyPlan: LegacyPlanAccountSummary[];
  /** Always empty in this report -- see module doc comment. Real
   * loss-making-account detection requires per-account JobCostRecord data
   * that doesn't exist yet in production. */
  lossMakingAccountIds: string[];
  costDataAvailable: false;
  notes: string[];
}

export async function generateMigrationImpactReport(): Promise<MigrationImpactReport> {
  const [totalAccounts, activeStripeSubscriptions, accountsWithBillingIssue, byPlanRaw] = await Promise.all([
    db.user.count(),
    db.user.count({ where: { stripeSubscriptionId: { not: null } } }),
    db.user.count({ where: { billingIssue: { not: null } } }),
    db.user.groupBy({ by: ["plan"], _count: { plan: true } }),
  ]);

  const byLegacyPlan: LegacyPlanAccountSummary[] = byPlanRaw.map((row) => {
    const legacyPlan = row.plan === "free" ? null : getLegacyPlanById(row.plan);
    const suggestedNewPlanId = LEGACY_TO_NEW_PLAN_MAP[row.plan] ?? null;
    const newConfig = suggestedNewPlanId ? PLAN_CONFIGS[suggestedNewPlanId] : null;

    const legacyMonthlyPriceUsd = row.plan === "free" ? 0 : legacyPlan ? parsePriceLabel(legacyPlan.priceLabel) : null;
    const legacyMonthlyCredits = row.plan === "free" ? 50 : legacyPlan?.monthlyCredits ?? null;

    return {
      legacyPlanId: row.plan,
      accountCount: row._count.plan,
      legacyMonthlyPriceUsd,
      legacyMonthlyCredits,
      suggestedNewPlanId,
      newMonthlyPriceUsd: newConfig?.monthlyPriceUsd ?? null,
      newMonthlyCredits: newConfig?.monthlyCredits ?? null,
      priceDeltaUsd:
        newConfig && legacyMonthlyPriceUsd !== null ? newConfig.monthlyPriceUsd - legacyMonthlyPriceUsd : null,
      creditsDeltaAtNewPrice:
        newConfig && legacyMonthlyCredits !== null ? newConfig.monthlyCredits - legacyMonthlyCredits : null,
    };
  });

  const notes: string[] = [
    "Cost-side comparison (real per-account render cost) is not available -- JobCostRecord is not yet populated by any live job runner. Do not treat this report as proof of profitability either way.",
  ];

  if (activeStripeSubscriptions === 0) {
    notes.push(
      "Zero active paid Stripe subscriptions at report generation time -- there is currently no paid customer base to migrate. The canonical recovery preserves the existing Free balance and all recognized legacy plan terms."
    );
  }

  return {
    generatedAt: new Date(),
    totalAccounts,
    activeStripeSubscriptions,
    accountsWithBillingIssue,
    byLegacyPlan,
    lossMakingAccountIds: [],
    costDataAvailable: false,
    notes,
  };
}

/** lib/plans.ts stores price as a display string like "$19.99/mo" -- this
 * parses it back to a number for comparison math. Returns null (not 0) if
 * the format is ever unrecognized, rather than silently miscomparing. */
function parsePriceLabel(priceLabel: string): number | null {
  const match = priceLabel.match(/\$([0-9.]+)/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}
