/**
 * Owner-provided cost rates (pricing overhaul brief, section 6: "Do not
 * invent missing expense values. Mark them for owner input.") -- every rate
 * below defaults to null, not a guessed number. AI/storage/compute pricing
 * changes over time and varies by contract; a memorized or estimated figure
 * baked into code is exactly the kind of invented cost the brief prohibits.
 *
 * Real, measurable USAGE (tokens, seconds, characters, bytes) is captured
 * unconditionally in lib/pricing/cost-tracking.ts regardless of whether a
 * rate exists yet -- only the USD conversion waits on a real rate. See
 * OWNER_ACTIONS_REQUIRED.md for the specific rates needed.
 *
 * Sourced from env vars (not hardcoded) so an owner can supply current
 * rates via docker-compose without a code change or redeploy -- same
 * pattern as the existing STORAGE_ and STRIPE_ env vars used throughout
 * this codebase, read fresh from process.env at request time.
 */

export interface CostRates {
  /** USD per 1,000 input tokens, per 1,000 output tokens -- varies by
   * model, so this is a single blended rate an owner sets per the actual
   * model mix in use, not a per-model table (keeps this file from needing
   * a code change every time a model is swapped). */
  aiInputPer1kTokensUsd: number | null;
  aiOutputPer1kTokensUsd: number | null;
  transcriptionPerMinuteUsd: number | null;
  ttsPerCharacterUsd: number | null;
  /** Self-hosted voice cloning (Coqui XTTS-v2) has no per-call price --
   * this is the owner's own estimated compute cost per second of the VPS
   * time it occupies. */
  voiceCloneComputePerSecondUsd: number | null;
  /** Render VPS compute cost per second of render time. */
  renderComputePerSecondUsd: number | null;
  storagePerGbMonthUsd: number | null;
  bandwidthPerGbUsd: number | null;
  /** Stripe's blended fee rate (e.g. 0.029 for 2.9%) plus a flat per-charge
   * fee, used by margin.ts to net out payment-processing cost. */
  stripePercentFee: number | null;
  stripeFlatFeeUsd: number | null;
}

function envFloat(name: string): number | null {
  const raw = process.env[name];
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export function getCostRates(): CostRates {
  return {
    aiInputPer1kTokensUsd: envFloat("COST_RATE_AI_INPUT_PER_1K_TOKENS_USD"),
    aiOutputPer1kTokensUsd: envFloat("COST_RATE_AI_OUTPUT_PER_1K_TOKENS_USD"),
    transcriptionPerMinuteUsd: envFloat("COST_RATE_TRANSCRIPTION_PER_MINUTE_USD"),
    ttsPerCharacterUsd: envFloat("COST_RATE_TTS_PER_CHARACTER_USD"),
    voiceCloneComputePerSecondUsd: envFloat("COST_RATE_VOICE_CLONE_COMPUTE_PER_SECOND_USD"),
    renderComputePerSecondUsd: envFloat("COST_RATE_RENDER_COMPUTE_PER_SECOND_USD"),
    storagePerGbMonthUsd: envFloat("COST_RATE_STORAGE_PER_GB_MONTH_USD"),
    bandwidthPerGbUsd: envFloat("COST_RATE_BANDWIDTH_PER_GB_USD"),
    stripePercentFee: envFloat("COST_RATE_STRIPE_PERCENT_FEE"),
    stripeFlatFeeUsd: envFloat("COST_RATE_STRIPE_FLAT_FEE_USD"),
  };
}
