/**
 * Future credit-cost modelling helpers. These are intentionally NOT the
 * live charging path; current generation products have a transparent flat
 * price defined by CREDITS_PER_VIDEO and reserve through pricing/ledger.
 *
 * Every constant below is copied verbatim from the owner's brief
 * (PRICING_OVERHAUL_BRIEF.md section 3) -- nothing here is invented.
 * Anywhere the brief didn't specify a number, the function throws instead
 * of guessing (see creditsForStandardVideo's >90s case).
 *
 * Do not surface these draft bands in UI or Stripe until an owner-approved
 * pricing version wires them into every charging path and acceptance test.
 */

export class UnpricedDurationError extends Error {
  constructor(durationSec: number) {
    super(
      `${durationSec}s is not a currently priced video length. The brief's credit table only defines up to 90 seconds (30-45s: 10cr, 46-60s: 15cr, 61-90s: 25cr) -- pricing beyond that is an owner decision, not something to guess at. See PRICING_MODEL.md.`
    );
    this.name = "UnpricedDurationError";
  }
}

/** Standard script-to-video length bands. The brief doesn't price anything
 * below 30s separately, so durations at or under 45s (including under 30s)
 * floor at the 10-credit band rather than inventing a cheaper tier. */
export function creditsForStandardVideo(durationSec: number): number {
  if (durationSec <= 0) throw new RangeError("durationSec must be positive");
  if (durationSec <= 45) return 10;
  if (durationSec <= 60) return 15;
  if (durationSec <= 90) return 25;
  throw new UnpricedDurationError(durationSec);
}

/** UGC-style ad: a flat cost regardless of duration, per the brief's own
 * single line item ("UGC-style ad: 15 credits") -- not banded like the
 * standard script-to-video workflow. */
export const UGC_AD_CREDITS = 15;

/** Per-uploaded-minute charge for the Repurpose workflow's source-processing
 * phase (transcription + highlight detection), charged once per upload
 * regardless of how many clips it eventually produces. */
export const REPURPOSE_SOURCE_CREDITS_PER_MINUTE = 2;

/** Per-clip charge for the Repurpose workflow, charged once EACH completed
 * clip finishes rendering -- not upfront for a predicted clip count, since
 * the actual number of clips produced isn't known until highlight detection
 * runs. A clip that fails never reaches this charge (see
 * lib/pricing/ledger.ts's per-clip reservation pattern). */
export const REPURPOSE_CLIP_CREDITS = 10;

export function creditsForRepurposeSource(sourceMinutes: number): number {
  if (sourceMinutes <= 0) throw new RangeError("sourceMinutes must be positive");
  return Math.ceil(sourceMinutes * REPURPOSE_SOURCE_CREDITS_PER_MINUTE);
}

export function creditsForRepurposeClips(completedClipCount: number): number {
  if (completedClipCount < 0) throw new RangeError("completedClipCount cannot be negative");
  return completedClipCount * REPURPOSE_CLIP_CREDITS;
}

export const THUMBNAIL_CREDITS = 1;

/** Add-on surcharges, stacked on top of a base video cost. */
export const SURCHARGE_PREMIUM_TTS = 3;
export const SURCHARGE_ADDITIONAL_ASPECT_RATIO = 3; // per aspect ratio beyond the primary one
export const SURCHARGE_4K_EXPORT = 15;
/** The brief specifies this as a floor ("at least +30 credits"), not a
 * fixed price -- lib/pricing/margin.ts's per-credit safe-cost check is what
 * should tell an owner whether 30 is still covering real voice-clone
 * compute cost once JobCostRecord data exists. Do not lower this constant
 * without that data; raising it is a pricing decision, not a code fix. */
export const SURCHARGE_VOICE_CLONING_MIN = 30;

export interface StandardVideoCostInput {
  durationSec: number;
  premiumTts?: boolean;
  additionalAspectRatios?: number; // count beyond the primary aspect ratio, e.g. 2 extra formats = 2
  export4k?: boolean;
  voiceCloning?: boolean;
}

export interface CreditCostBreakdown {
  baseCredits: number;
  surcharges: { label: string; credits: number }[];
  totalCredits: number;
}

function withSurcharges(baseCredits: number, input: {
  premiumTts?: boolean;
  additionalAspectRatios?: number;
  export4k?: boolean;
  voiceCloning?: boolean;
}): CreditCostBreakdown {
  const surcharges: { label: string; credits: number }[] = [];

  if (input.premiumTts) surcharges.push({ label: "Premium voice", credits: SURCHARGE_PREMIUM_TTS });

  const extraFormats = input.additionalAspectRatios ?? 0;
  if (extraFormats > 0) {
    surcharges.push({
      label: extraFormats === 1 ? "Additional aspect ratio" : `${extraFormats} additional aspect ratios`,
      credits: SURCHARGE_ADDITIONAL_ASPECT_RATIO * extraFormats,
    });
  }

  if (input.export4k) surcharges.push({ label: "4K export", credits: SURCHARGE_4K_EXPORT });
  if (input.voiceCloning) surcharges.push({ label: "Voice cloning", credits: SURCHARGE_VOICE_CLONING_MIN });

  const totalCredits = baseCredits + surcharges.reduce((sum, s) => sum + s.credits, 0);
  return { baseCredits, surcharges, totalCredits };
}

/** Full cost breakdown for a standard script-to-video generation, including
 * every applicable surcharge. This is what the pricing page's "exact cost
 * before generation" display and the generation API should both call. */
export function calculateStandardVideoCost(input: StandardVideoCostInput): CreditCostBreakdown {
  const base = creditsForStandardVideo(input.durationSec);
  return withSurcharges(base, input);
}

export interface UgcAdCostInput {
  premiumTts?: boolean;
  additionalAspectRatios?: number;
  export4k?: boolean;
  voiceCloning?: boolean;
}

export function calculateUgcAdCost(input: UgcAdCostInput = {}): CreditCostBreakdown {
  return withSurcharges(UGC_AD_CREDITS, input);
}

/** Repurpose is charged in two separate reservations (see
 * lib/pricing/ledger.ts): the source-processing charge up front, and one
 * REPURPOSE_CLIP_CREDITS charge per clip as it actually completes. This
 * helper is for display/estimation only (e.g. "up to 5 clips could cost up
 * to X credits") -- it is NOT how the real charge is executed. */
export function estimateRepurposeCost(sourceMinutes: number, estimatedClipCount: number): CreditCostBreakdown {
  const baseCredits = creditsForRepurposeSource(sourceMinutes);
  const clipCredits = creditsForRepurposeClips(estimatedClipCount);
  return {
    baseCredits,
    surcharges: [{ label: `${estimatedClipCount} estimated clip(s)`, credits: clipCredits }],
    totalCredits: baseCredits + clipCredits,
  };
}
