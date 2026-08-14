import { db } from "@/lib/db";
import { generateScript } from "@/lib/providers/script";
import { synthesizeVoiceover } from "@/lib/providers/tts";
import { cloneVoice } from "@/lib/providers/voice-clone";
import { pickBrollScenes } from "@/lib/providers/broll";
import { renderScriptVideo } from "@/lib/remotion-render";
import { recordActivity } from "@/lib/streaks";
import { getLanguage } from "@/lib/languages";
import { computeSceneTimeline } from "@/lib/timeline";
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

/** Looks up the CreditReservation linked to a job (set in the API route via
 * attachReservationToJob). Returns null for demo jobs and legacy jobs that
 * predate the reservation system. */
async function findReservationId(jobId: string): Promise<string | null> {
  const res = await db.creditReservation.findUnique({ where: { jobId } }).catch(() => null);
  return res?.id ?? null;
}

export async function runScriptJob(jobId: string, workerId: string, attemptToken: string) {
  const job = await db.job.findUniqueOrThrow({ where: { id: jobId }, include: { project: { include: { user: true } } } });
  const project = job.project;

  try {
    await db.job.update({ where: { id: jobId }, data: { status: "processing", progress: 5 } });
    await db.project.update({ where: { id: project.id }, data: { status: "processing" } });

    const input = JSON.parse(project.input) as {
      topic: string;
      voice?: string;
      language?: string;
      aspectRatio?: AspectRatio;
      voiceSampleUrl?: string;
      watermark?: boolean;
      /** Set by the unauthenticated homepage demo route — never touches a
       * paid provider even if OPENAI_API_KEY is configured globally, since
       * this path is driven by anonymous internet traffic, not a signed-up
       * user's own request. */
      freeOnly?: boolean;
    };
    const mediaKeyPrefix = `media/${project.userId}/${project.id}`;
    const language = getLanguage(input.language ?? "en");

    await setJobProgress(jobId, 10, "Writing script…");
    const scriptResult = await generateScript(input.topic, input.freeOnly, language.label);

    await setJobProgress(jobId, 30, "Selecting b-roll…");
    const scenes = await pickBrollScenes(scriptResult.sceneKeywords);

    await setJobProgress(jobId, 45, input.voiceSampleUrl ? "Cloning your voice…" : "Generating voiceover…");
    const voiceover = input.voiceSampleUrl
      ? await cloneVoice(input.voiceSampleUrl, scriptResult.script, mediaKeyPrefix).catch((err) => {
          console.error(
            "[script-runner] voice cloning failed, falling back to default TTS:",
            err instanceof Error ? err.message : err
          );
          return synthesizeVoiceover(scriptResult.script, mediaKeyPrefix, input.voice, input.freeOnly, language.code);
        })
      : await synthesizeVoiceover(scriptResult.script, mediaKeyPrefix, input.voice, input.freeOnly, language.code);

    const sceneTimeline = computeSceneTimeline(scenes, voiceover.durationSec);
    const brand = await getBrandForRender(project.userId);

    await db.project.update({
      where: { id: project.id },
      data: {
        title: scriptResult.title,
        script: scriptResult.script,
        voiceoverUrl: voiceover.audioUrl,
        captionsJson: JSON.stringify(voiceover.words),
        scenesJson: JSON.stringify(sceneTimeline),
      },
    });

    await setJobProgress(jobId, 60, "Rendering video…");
    const renderStart = Date.now();
    const videoUrl = await renderScriptVideo(
      {
        words: voiceover.words,
        scenes,
        audioUrl: voiceover.audioUrl,
        durationInSeconds: voiceover.durationSec,
        aspectRatio: input.aspectRatio,
        watermark: input.watermark,
        brand,
      },
      `${mediaKeyPrefix}/final.mp4`,
      (percent) => {
        void setJobProgress(jobId, 60 + Math.round(percent * 0.35));
      }
    );
    const renderSeconds = (Date.now() - renderStart) / 1000;

    // Project "ready", Job "done", and the reservation capture must land
    // together or not at all -- a crash between separate writes here used
    // to leave a "done" job with its reservation stuck "reserved" forever,
    // invisible to startup reconciliation (which only ever looks at
    // "processing" jobs). See captureReservationInTx in lib/pricing/ledger.ts.
    // Verify lease ownership (stale worker rejection) before commit.
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

    // Record measurable usage for cost tracking (best-effort — never throws,
    // and deliberately outside the transaction above: this is non-critical
    // telemetry that should never roll back a successful render's status/
    // capture if it fails for an unrelated reason).
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
    }).catch((e) => console.error("[script-runner] cost record write failed:", e instanceof Error ? e.message : e));

    await recordActivity(project.userId);
  } catch (err) {
    // Lease lost: stale worker, job reassigned to another worker
    if (err instanceof LeaseLostError) {
      console.error(`[script-runner] lease lost for job ${jobId}, stale worker aborting`);
      return;
    }

    const message = err instanceof Error ? err.message : "Unknown error";
    const reservationId = await findReservationId(jobId).catch(() => null);

    if (reservationId) {
      // Reservation-backed job: Project failed + Job failed + reservation
      // released + balance restored + refund ledger entry must land
      // together or not at all -- a crash between separate writes here
      // used to be able to leave a "failed" job with its reservation stuck
      // "reserved" forever, invisible to startup reconciliation (which
      // only ever looks at "processing" jobs). See releaseReservationInTx
      // in lib/pricing/ledger.ts.
      await db
        .$transaction(async (tx) => {
          await tx.project.update({ where: { id: project.id }, data: { status: "failed", errorMessage: message } });
          await tx.job.update({ where: { id: jobId }, data: { status: "failed", log: message } });
          await releaseReservationInTx(tx, reservationId, message);
        })
        .catch((e) => {
          // Deliberately no fallback writes here -- if the transaction
          // failed, NOTHING committed, so the job is still exactly as it
          // was before this catch block ran ("processing", reservation
          // still "reserved"). That's a safe, recoverable state: the next
          // worker startup's reconciliation will find and finalize it.
          // Writing a partial "failed" status here without the matching
          // release would recreate the exact bug this pass closes.
          console.error(
            "[script-runner] atomic failure finalization failed -- job remains recoverable as processing/reserved:",
            e instanceof Error ? e.message : e
          );
        });
    } else {
      // Legacy/demo fallback: no reservation exists for this job (a demo
      // job -- see lib/demo-user.ts, which never gets a reservation at all
      // -- or a job that predates the reservation system). This path is
      // NOT part of this hardening pass: it uses lib/credits.ts's simpler,
      // older charge/refund mechanism, never wired into the ledger's
      // transactional guarantees. Marking Project/Job failed and calling
      // refundCredits() remain separate statements here, same as before --
      // see OPERATIONS.md for why this residual gap is accepted rather
      // than silently expanded into a new billing path.
      await db.project.update({ where: { id: project.id }, data: { status: "failed", errorMessage: message } });
      await db.job.update({ where: { id: jobId }, data: { status: "failed", log: message } });
      const creditOwnerId = await resolveProjectCreditOwnerId(project).catch(() => project.userId);
      await refundCredits(creditOwnerId, CREDITS_PER_VIDEO).catch((e) =>
        console.error("[script-runner] legacy credit refund failed:", e instanceof Error ? e.message : e)
      );
    }

    // Record that credits were refunded in the cost record.
    await upsertCostRecord({
      jobId,
      projectId: project.id,
      userId: project.userId,
      creditsRefunded: CREDITS_PER_VIDEO,
    }).catch(() => {});
  }
}
