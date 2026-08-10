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
import { resolveProjectCreditOwnerId } from "@/lib/workspace";
import type { AspectRatio } from "@/lib/aspect-ratio";

async function setJobProgress(jobId: string, progress: number, log?: string) {
  await db.job.update({ where: { id: jobId }, data: { progress, ...(log ? { log } : {}) } });
}

export async function runScriptJob(jobId: string) {
  const job = await db.job.findUniqueOrThrow({ where: { id: jobId }, include: { project: { include: { user: true } } } });
  const project = job.project;

  try {
    await db.job.update({ where: { id: jobId }, data: { status: "processing", progress: 5 } });
    await db.project.update({ where: { id: project.id }, data: { status: "processing" } });

    const input = JSON.parse(project.input) as {
      topic: string;
      voice?: string;
      language?: string; // ISO-ish short code, see lib/languages.ts -- defaults to English
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
        // Map render progress (0-100) onto the remaining 60-95 job range.
        void setJobProgress(jobId, 60 + Math.round(percent * 0.35));
      }
    );

    await db.project.update({
      where: { id: project.id },
      data: { status: "ready", videoUrl },
    });
    await db.job.update({ where: { id: jobId }, data: { status: "done", progress: 100, log: "Done" } });
    await recordActivity(project.userId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    await db.project.update({ where: { id: project.id }, data: { status: "failed", errorMessage: message } });
    await db.job.update({ where: { id: jobId }, data: { status: "failed", log: message } });
    const creditOwnerId = await resolveProjectCreditOwnerId(project);
    await refundCredits(creditOwnerId, CREDITS_PER_VIDEO).catch((e) =>
      console.error("[script-runner] credit refund failed:", e instanceof Error ? e.message : e)
    );
  }
}
