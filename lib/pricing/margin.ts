/**
 * Profitability safeguards (pricing overhaul brief, section 7). Every
 * formula here is copied verbatim from the brief -- pure functions over
 * numbers the caller supplies (from JobCostRecord / PlanVersion / Stripe
 * data), so this module never itself invents a cost or margin figure.
 */

export interface ContributionMarginInput {
  netRevenueUsd: number;
  aiCostUsd: number;
  transcriptionCostUsd: number;
  ttsCostUsd: number;
  renderingCostUsd: number;
  storageEgressCostUsd: number;
  stripeFeesUsd: number;
  refundsChargebacksUsd: number;
  otherDirectCostsUsd: number;
}

/** Contribution margin = net revenue - AI - transcription - TTS -
 * rendering - storage/egress - Stripe fees - refunds/chargebacks - other
 * direct costs, expressed as a fraction of net revenue (0.7 = 70%). */
export function contributionMargin(input: ContributionMarginInput): number {
  if (input.netRevenueUsd <= 0) return 0;
  const totalCost =
    input.aiCostUsd +
    input.transcriptionCostUsd +
    input.ttsCostUsd +
    input.renderingCostUsd +
    input.storageEgressCostUsd +
    input.stripeFeesUsd +
    input.refundsChargebacksUsd +
    input.otherDirectCostsUsd;
  return (input.netRevenueUsd - totalCost) / input.netRevenueUsd;
}

/** Maximum safe variable cost per credit = net plan revenue * 30% / included
 * credits -- the ceiling a plan's real per-credit cost must stay under to
 * hit the 70% contribution-margin target at full legitimate usage. */
export function maxSafeCostPerCredit(netPlanRevenueUsd: number, includedCredits: number): number {
  if (includedCredits <= 0) throw new RangeError("includedCredits must be positive");
  return (netPlanRevenueUsd * 0.3) / includedCredits;
}

export const MARGIN_WARNING_THRESHOLD = 0.7; // brief: "Plan margin falls below 70%"
export const MARGIN_CRITICAL_THRESHOLD = 0.5; // brief: "Margin falls below 50% critically"
export const RETRY_RATE_WARNING_THRESHOLD = 0.1; // brief: "Retries exceed 10% of production cost"
export const CUSTOMER_COST_WARNING_THRESHOLD = 0.3; // brief: "Customer cost exceeds 30% of net subscription revenue"

export type MarginAlertSeverity = "ok" | "warning" | "critical";

export function classifyPlanMargin(marginFraction: number): MarginAlertSeverity {
  if (marginFraction < MARGIN_CRITICAL_THRESHOLD) return "critical";
  if (marginFraction < MARGIN_WARNING_THRESHOLD) return "warning";
  return "ok";
}

export function isJobAtLoss(jobCostUsd: number, allocatedRevenueUsd: number): boolean {
  return jobCostUsd > allocatedRevenueUsd;
}

export function isRetryRateExcessive(retryCostUsd: number, totalProductionCostUsd: number): boolean {
  if (totalProductionCostUsd <= 0) return false;
  return retryCostUsd / totalProductionCostUsd > RETRY_RATE_WARNING_THRESHOLD;
}

export function isCustomerCostExcessive(customerCostUsd: number, netSubscriptionRevenueUsd: number): boolean {
  if (netSubscriptionRevenueUsd <= 0) return customerCostUsd > 0;
  return customerCostUsd / netSubscriptionRevenueUsd > CUSTOMER_COST_WARNING_THRESHOLD;
}

export interface DailySpendCheckInput {
  spentTodayUsd: number;
  dailyCapUsd: number;
}

export function isDailySpendCapReached(input: DailySpendCheckInput): boolean {
  return input.spentTodayUsd >= input.dailyCapUsd;
}
