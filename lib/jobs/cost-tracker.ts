/**
 * Helpers for populating JobCostRecord rows during job execution.
 *
 * Design principles:
 * - Upsert: cost data arrives at different points in the runner (LLM first,
 *   then TTS, then render, etc.). Upsert lets each step append its own
 *   measurements without the runner needing to keep a single accumulator.
 * - Fire-and-forget: cost writes are best-effort. A failure here must never
 *   prevent the job from completing or credits from being refunded.
 * - No fabricated dollar amounts: only measurable usage quantities are
 *   recorded (tokens, seconds, bytes). The $/unit conversion belongs in a
 *   future reporting layer, once per-provider pricing is verified.
 */
import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";

export interface JobCostData {
  jobId: string;
  projectId: string;
  userId: string;

  // LLM (script generation)
  aiProvider?: string | null;
  aiModel?: string | null;
  aiInputTokens?: number | null;
  aiOutputTokens?: number | null;

  // Transcription (repurpose)
  transcriptionSeconds?: number | null;

  // TTS
  ttsCharacters?: number | null;
  ttsSeconds?: number | null;

  // Rendering (remotion + ffmpeg)
  renderSeconds?: number | null;

  // Storage (output upload)
  storageBytes?: bigint | null;

  // Credit accounting
  creditsCharged?: number;
  creditsRefunded?: number;
}

type CostRecordTransaction = {
  jobCostRecord: {
    upsert(args: Prisma.JobCostRecordUpsertArgs): Promise<unknown>;
  };
};

/** Creates or updates the JobCostRecord for a given job. Each field is only
 * written when explicitly provided, so callers can upsert partial data at
 * each stage of execution without needing to carry full state. Fire-and-forget:
 * failures are logged but not propagated. */
export async function upsertCostRecord(data: JobCostData): Promise<void> {
  const updatePayload: Record<string, unknown> = {};
  if (data.aiProvider !== undefined) updatePayload.aiProvider = data.aiProvider;
  if (data.aiModel !== undefined) updatePayload.aiModel = data.aiModel;
  if (data.aiInputTokens !== undefined) updatePayload.aiInputTokens = data.aiInputTokens;
  if (data.aiOutputTokens !== undefined) updatePayload.aiOutputTokens = data.aiOutputTokens;
  if (data.transcriptionSeconds !== undefined) updatePayload.transcriptionSeconds = data.transcriptionSeconds;
  if (data.ttsCharacters !== undefined) updatePayload.ttsCharacters = data.ttsCharacters;
  if (data.ttsSeconds !== undefined) updatePayload.ttsSeconds = data.ttsSeconds;
  if (data.renderSeconds !== undefined) updatePayload.renderSeconds = data.renderSeconds;
  if (data.storageBytes !== undefined) updatePayload.storageBytes = data.storageBytes;
  if (data.creditsCharged !== undefined) updatePayload.creditsCharged = data.creditsCharged;
  if (data.creditsRefunded !== undefined) updatePayload.creditsRefunded = data.creditsRefunded;

  await db.jobCostRecord.upsert({
    where: { jobId: data.jobId },
    create: {
      jobId: data.jobId,
      projectId: data.projectId,
      userId: data.userId,
      aiProvider: data.aiProvider ?? null,
      aiModel: data.aiModel ?? null,
      aiInputTokens: data.aiInputTokens ?? null,
      aiOutputTokens: data.aiOutputTokens ?? null,
      transcriptionSeconds: data.transcriptionSeconds ?? null,
      ttsCharacters: data.ttsCharacters ?? null,
      ttsSeconds: data.ttsSeconds ?? null,
      renderSeconds: data.renderSeconds ?? null,
      storageBytes: data.storageBytes ?? null,
      creditsCharged: data.creditsCharged ?? 0,
      creditsRefunded: data.creditsRefunded ?? 0,
    },
    update: updatePayload,
  });
}

/** Transaction-safe version of upsertCostRecord. Call this inside a db.$transaction
 * block to ensure cost recording is atomic with job completion/failure. Returns
 * true if upsert succeeded, false on error (error is still logged by caller). */
export async function upsertCostRecordInTx(
  tx: CostRecordTransaction,
  data: JobCostData
): Promise<boolean> {
  const updatePayload: Record<string, unknown> = {};
  if (data.aiProvider !== undefined) updatePayload.aiProvider = data.aiProvider;
  if (data.aiModel !== undefined) updatePayload.aiModel = data.aiModel;
  if (data.aiInputTokens !== undefined) updatePayload.aiInputTokens = data.aiInputTokens;
  if (data.aiOutputTokens !== undefined) updatePayload.aiOutputTokens = data.aiOutputTokens;
  if (data.transcriptionSeconds !== undefined) updatePayload.transcriptionSeconds = data.transcriptionSeconds;
  if (data.ttsCharacters !== undefined) updatePayload.ttsCharacters = data.ttsCharacters;
  if (data.ttsSeconds !== undefined) updatePayload.ttsSeconds = data.ttsSeconds;
  if (data.renderSeconds !== undefined) updatePayload.renderSeconds = data.renderSeconds;
  if (data.storageBytes !== undefined) updatePayload.storageBytes = data.storageBytes;
  if (data.creditsCharged !== undefined) updatePayload.creditsCharged = data.creditsCharged;
  if (data.creditsRefunded !== undefined) updatePayload.creditsRefunded = data.creditsRefunded;

  try {
    await tx.jobCostRecord.upsert({
      where: { jobId: data.jobId },
      create: {
        jobId: data.jobId,
        projectId: data.projectId,
        userId: data.userId,
        aiProvider: data.aiProvider ?? null,
        aiModel: data.aiModel ?? null,
        aiInputTokens: data.aiInputTokens ?? null,
        aiOutputTokens: data.aiOutputTokens ?? null,
        transcriptionSeconds: data.transcriptionSeconds ?? null,
        ttsCharacters: data.ttsCharacters ?? null,
        ttsSeconds: data.ttsSeconds ?? null,
        renderSeconds: data.renderSeconds ?? null,
        storageBytes: data.storageBytes ?? null,
        creditsCharged: data.creditsCharged ?? 0,
        creditsRefunded: data.creditsRefunded ?? 0,
      },
      update: updatePayload,
    });
    return true;
  } catch (err) {
    console.error(
      `[cost-tracker] failed to record cost for job ${data.jobId}:`,
      err instanceof Error ? err.message : String(err)
    );
    return false;
  }
}
