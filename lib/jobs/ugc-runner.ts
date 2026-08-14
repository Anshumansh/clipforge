import { db } from "@/lib/db";
import { generateAdScript } from "@/lib/providers/script";
import { synthesizeVoiceover } from "@/lib/providers/tts";
import { pickBrollScenes } from "@/lib/providers/broll";
import { renderScriptVideo } from "@/lib/remotion-render";
import { recordActivity } from "@/lib/streaks";
import { getBrandForRender } from "@/lib/brand-server";
import { refundCredits, CREDITS_PER_VIDEO } from "@/lib/credits";
import { captureReservationInTx, releaseReservationInTx } from "@/lib/pricing/ledger";
import { resolveProjectCreditOwnerId } from "@/lib/workspace";
import { upsertCostRecord } from "@/lib/jobs/cost-tracker";
import { LeaseLostError } from "@/lib/jobs/claim";
import type { AspectRatio } from "@/lib/aspect-ratio";

async function setJobProgress(jobId: string, progress: number, log?: string) {
  await db.job.update({ where: { id: jobId }, data: { progress, ...(log ? { log } : {}) } });
}

async function findReservationId(jobId: string): Promise<string | null> {
  const res = await db.creditReservation.findUnique({ where: { jobId } }).catch(() => null);
  return res?.id ?? null;
}

export async function runUgcJob(jobId: string, workerId: string, attemptToken: string) {
  const job = await db.job.findUniqueOrThrow({ where: { id: jobId }, include: { project: { include: { user: true } } } });
  const project = job.project;

  try {
    await db.job.update({ where: { id: jobId }, data: { status: "processing", progress: 5 } });
    await db.project.update({ where: { id: project.id }, data: { status: "processing" } });

    const input = JSON.parse(project.input) as {
      productName: string;
      sellingPoints: string;
      ctaText: string;
      voice?: string;
      aspectRatio?: AspectRatio;
    };
    const mediaKeyPrefix = `media/${project.userId}/${project.id}`;

    await setJobProgress(jobId, 10, "Writing ad script…");
    const scriptResult = await generateAdScript(input.productName, input.sellingPoints);

    await setJobProgress(jobId, 30, "Selecting b-roll…");
    const scenes = await pickBrollScenes(scriptResult.sceneKeywords);

    await setJobProgress(jobId, 45, "Generating voiceover…");
    const voiceover = await synthesizeVoiceover(scriptResult.script, mediaKeyPrefix, input.voice);

    await db.project.update({
      where: { id: project.id },
      data: {
        title: scriptResult.title,
        script: scriptResult.script,
        voiceoverUrl: voiceover.audioUrl,
        captionsJson: JSON.stringify(voiceover.words),
      },
    });

    const brand = await getBrandForRender(project.userId);

    await setJobProgress(jobId, 60, "Rendering ad video…");
    const renderStart = Date.now();
    const videoUrl = await renderScriptVideo(
      {
        words: voiceover.words,
        scenes,
        audioUrl: voiceover.audioUrl,
        durationInSeconds: voiceover.durationSec + 2,
        ctaText: input.ctaText || `Get ${input.productName} today`,
        aspectRatio: input.aspectRatio,
        brand,
      },
      `${mediaKeyPrefix}/final.mp4`,
      (percent) => {
        void setJobProgress(jobId, 60 + Math.round(percent * 0.35));
      }
    );
    const renderSeconds = (Date.now() - renderStart) / 1000;

    // Project "ready", Job "done", and the reservation capture must land
    // together or not at all -- see the identical comment in
    // lib/jobs/script-runner.ts and captureReservationInTx in
    // lib/pricing/ledger.ts. Verify lease ownership before commit.
    const reservationId = await findReservationId(jobId);
    await db.$transaction(async (tx) => {
      const updated = await tx.job.updateMany({
        where: { id: jobId, status: "processing", workerId, attemptToken },
        data: { status: "done", progress: 100, log: "Done" }
      });
      if (updated.count === 0) {
        throw new LeaseLostError(jobId);
      }
      await tx.project.update({ where: { id: project.id }, data: { status: "ready", videoUrl } });
      if (reservationId) {
        await captureReservationInTx(tx, reservationId);
      }
    });

    // Best-effort telemetry, deliberately outside the transaction above --
    // see the identical comment in lib/jobs/script-runner.ts.
    await upsertCostRecord({
      jobId,
      projectId: project.id,
      userId: project.userId,
      aiProvider: scriptResult.provider ?? null,
      aiModel:
        scriptResult.provider === "openai" ? "gpt-4o-mini"
        : scriptResult.provider === "groq" ? "llama-3.3-70b-versatile"
        : null,
      aiInputTokens: scriptResult.inputTokens ?? null,
      aiOutputTokens: scriptResult.outputTokens ?? null,
      ttsCharacters: voiceover.characterCount ?? null,
      ttsSeconds: voiceover.durationSec,
      renderSeconds,
      creditsCharged: CREDITS_PER_VIDEO,
    }).catch((e) => console.error("[ugc-runner] cost record write failed:", e instanceof Error ? e.message : e));

    await recordActivity(project.userId);
  } catch (err) {
    // Lease lost: stale worker, job reassigned to another worker
    if (err instanceof LeaseLostError) {
      console.error(`[ugc-runner] lease lost for job ${jobId}, stale worker aborting`);
      return;
    }

    const message = err instanceof Error ? err.message : "Unknown error";
    const reservationId = await findReservationId(jobId).catch(() => null);

    if (reservationId) {
      // Atomic failure finalization with lease verification. Only proceeds if
      // we still own the job (workerId + attemptToken match). See lib/pricing/ledger.ts.
      try {
        await db.$transaction(async (tx) => {
          // Atomic lease check + status update
          const updated = await tx.job.updateMany({
            where: { id: jobId, status: "processing", workerId, attemptToken },
            data: { status: "failed", log: message }
          });
          if (updated.count === 0) {
            throw new LeaseLostError(jobId);
          }
          // Lease verified; safe to finalize
          await tx.project.update({ where: { id: project.id }, data: { status: "failed", errorMessage: message } });
          await releaseReservationInTx(tx, reservationId, message);
        });
      } catch (e) {
        // Lease lost during error finalization: stale worker, abort
        if (e instanceof LeaseLostError) {
          console.error(`[ugc-runner] lease lost during error handling for job ${jobId}, not finalizing`);
          return;
        }
        // Transaction failure: job remains in "processing" state
        console.error(
          "[ugc-runner] atomic failure finalization failed -- job remains recoverable as processing/reserved:",
          e instanceof Error ? e.message : e
        );
      }
    } else {
      // Legacy/demo fallback: verify lease before marking failed
      try {
        const updated = await db.job.updateMany({
          where: { id: jobId, status: "processing", workerId, attemptToken },
          data: { status: "failed", log: message }
        });
        if (updated.count === 0) {
          console.error(`[ugc-runner] lease lost during error handling for job ${jobId}, not finalizing`);
          return;
        }
        // Lease verified; safe to update project and refund
        await db.project.update({ where: { id: project.id }, data: { status: "failed", errorMessage: message } });
        const creditOwnerId = await resolveProjectCreditOwnerId(project).catch(() => project.userId);
        await refundCredits(creditOwnerId, CREDITS_PER_VIDEO).catch((e) =>
          console.error("[ugc-runner] legacy credit refund failed:", e instanceof Error ? e.message : e)
        );
      } catch (e) {
        console.error(
          "[ugc-runner] failure finalization failed -- job remains in processing state:",
          e instanceof Error ? e.message : e
        );
      }
    }

    await upsertCostRecord({
      jobId,
      projectId: project.id,
      userId: project.userId,
      creditsRefunded: CREDITS_PER_VIDEO,
    }).catch(() => {});
  }
}
