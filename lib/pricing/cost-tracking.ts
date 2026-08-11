/**
 * Per-generation expense tracking (pricing overhaul brief, section 6).
 * Records real, measured usage unconditionally; converts to USD only where
 * an owner-supplied rate exists (lib/pricing/cost-rates.ts) -- a missing
 * rate leaves the *CostUsd field null, never 0, so margin math downstream
 * can tell "known to cost nothing" apart from "cost unknown".
 *
 * Not yet called from any job runner -- wiring this into
 * lib/jobs/*-runner.ts is tracked separately so each runner's usage
 * capture can be reviewed against what that specific provider call
 * actually returns, rather than guessed at here.
 */
import { db } from "@/lib/db";
import type { CostRates } from "@/lib/pricing/cost-rates";

export interface JobUsage {
  jobId: string;
  projectId: string;
  userId: string;
  aiProvider?: string;
  aiModel?: string;
  aiInputTokens?: number;
  aiOutputTokens?: number;
  transcriptionSeconds?: number;
  ttsCharacters?: number;
  ttsSeconds?: number;
  voiceCloneComputeSec?: number;
  renderSeconds?: number;
  storageBytes?: number;
  bandwidthBytes?: number;
  retryCount?: number;
  creditsCharged?: number;
  creditsRefunded?: number;
}

function computeCostsUsd(usage: JobUsage, rates: CostRates) {
  const aiCostUsd =
    rates.aiInputPer1kTokensUsd !== null && usage.aiInputTokens !== undefined
      ? (usage.aiInputTokens / 1000) * rates.aiInputPer1kTokensUsd +
        (rates.aiOutputPer1kTokensUsd !== null && usage.aiOutputTokens !== undefined
          ? (usage.aiOutputTokens / 1000) * rates.aiOutputPer1kTokensUsd
          : 0)
      : null;

  const transcriptionCostUsd =
    rates.transcriptionPerMinuteUsd !== null && usage.transcriptionSeconds !== undefined
      ? (usage.transcriptionSeconds / 60) * rates.transcriptionPerMinuteUsd
      : null;

  const ttsCostUsd =
    rates.ttsPerCharacterUsd !== null && usage.ttsCharacters !== undefined
      ? usage.ttsCharacters * rates.ttsPerCharacterUsd
      : null;

  const voiceCloneCostUsd =
    rates.voiceCloneComputePerSecondUsd !== null && usage.voiceCloneComputeSec !== undefined
      ? usage.voiceCloneComputeSec * rates.voiceCloneComputePerSecondUsd
      : null;

  const renderCostUsd =
    rates.renderComputePerSecondUsd !== null && usage.renderSeconds !== undefined
      ? usage.renderSeconds * rates.renderComputePerSecondUsd
      : null;

  const storageCostUsd =
    rates.storagePerGbMonthUsd !== null && usage.storageBytes !== undefined
      ? (usage.storageBytes / 1_000_000_000) * rates.storagePerGbMonthUsd
      : null;

  const bandwidthCostUsd =
    rates.bandwidthPerGbUsd !== null && usage.bandwidthBytes !== undefined
      ? (usage.bandwidthBytes / 1_000_000_000) * rates.bandwidthPerGbUsd
      : null;

  return { aiCostUsd, transcriptionCostUsd, ttsCostUsd, voiceCloneCostUsd, renderCostUsd, storageCostUsd, bandwidthCostUsd };
}

/** Upserts the JobCostRecord for a job, merging new usage fields with
 * whatever's already recorded (a job's cost data arrives progressively --
 * AI/TTS usage is known early, render/storage usage only once rendering
 * finishes) and recomputing every *CostUsd field from current rates. */
export async function recordJobUsage(usage: JobUsage, rates: CostRates): Promise<void> {
  const costs = computeCostsUsd(usage, rates);

  await db.jobCostRecord.upsert({
    where: { jobId: usage.jobId },
    create: {
      jobId: usage.jobId,
      projectId: usage.projectId,
      userId: usage.userId,
      aiProvider: usage.aiProvider,
      aiModel: usage.aiModel,
      aiInputTokens: usage.aiInputTokens,
      aiOutputTokens: usage.aiOutputTokens,
      transcriptionSeconds: usage.transcriptionSeconds,
      ttsCharacters: usage.ttsCharacters,
      ttsSeconds: usage.ttsSeconds,
      voiceCloneComputeSec: usage.voiceCloneComputeSec,
      renderSeconds: usage.renderSeconds,
      storageBytes: usage.storageBytes !== undefined ? BigInt(Math.round(usage.storageBytes)) : undefined,
      bandwidthBytes: usage.bandwidthBytes !== undefined ? BigInt(Math.round(usage.bandwidthBytes)) : undefined,
      retryCount: usage.retryCount ?? 0,
      creditsCharged: usage.creditsCharged ?? 0,
      creditsRefunded: usage.creditsRefunded ?? 0,
      ...costs,
    },
    update: {
      aiProvider: usage.aiProvider,
      aiModel: usage.aiModel,
      aiInputTokens: usage.aiInputTokens,
      aiOutputTokens: usage.aiOutputTokens,
      transcriptionSeconds: usage.transcriptionSeconds,
      ttsCharacters: usage.ttsCharacters,
      ttsSeconds: usage.ttsSeconds,
      voiceCloneComputeSec: usage.voiceCloneComputeSec,
      renderSeconds: usage.renderSeconds,
      storageBytes: usage.storageBytes !== undefined ? BigInt(Math.round(usage.storageBytes)) : undefined,
      bandwidthBytes: usage.bandwidthBytes !== undefined ? BigInt(Math.round(usage.bandwidthBytes)) : undefined,
      retryCount: usage.retryCount,
      creditsCharged: usage.creditsCharged,
      creditsRefunded: usage.creditsRefunded,
      ...costs,
    },
  });
}

/** Total known cost for a job -- sums every non-null *CostUsd field.
 * Returns null (not 0) if every component is still unknown, so a caller
 * can distinguish "this job is free" from "we don't have rate data yet". */
export function totalKnownCostUsd(record: {
  aiCostUsd: number | null;
  transcriptionCostUsd: number | null;
  ttsCostUsd: number | null;
  voiceCloneCostUsd: number | null;
  renderCostUsd: number | null;
  storageCostUsd: number | null;
  bandwidthCostUsd: number | null;
  retryCostUsd: number | null;
}): number | null {
  const values = [
    record.aiCostUsd,
    record.transcriptionCostUsd,
    record.ttsCostUsd,
    record.voiceCloneCostUsd,
    record.renderCostUsd,
    record.storageCostUsd,
    record.bandwidthCostUsd,
    record.retryCostUsd,
  ].filter((v): v is number => v !== null);

  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0);
}
