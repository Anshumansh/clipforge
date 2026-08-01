import path from "node:path";
import fs from "node:fs/promises";
import { db } from "@/lib/db";
import { generateScript } from "@/lib/providers/script";
import { synthesizeVoiceover } from "@/lib/providers/tts";
import { pickBrollScenes } from "@/lib/providers/broll";
import { renderScriptVideo } from "@/lib/remotion-render";

async function setJobProgress(jobId: string, progress: number, log?: string) {
  await db.job.update({ where: { id: jobId }, data: { progress, ...(log ? { log } : {}) } });
}

export async function runScriptJob(jobId: string) {
  const job = await db.job.findUniqueOrThrow({ where: { id: jobId }, include: { project: true } });
  const project = job.project;

  try {
    await db.job.update({ where: { id: jobId }, data: { status: "processing", progress: 5 } });
    await db.project.update({ where: { id: project.id }, data: { status: "processing" } });

    const input = JSON.parse(project.input) as { topic: string; voice?: string };

    await setJobProgress(jobId, 10, "Writing script…");
    const scriptResult = await generateScript(input.topic);

    await setJobProgress(jobId, 30, "Selecting b-roll…");
    const scenes = await pickBrollScenes(scriptResult.sceneKeywords);

    const publicDestDir = path.join(process.cwd(), "public", "media", project.userId, project.id);
    const publicUrlPrefix = `/media/${project.userId}/${project.id}`;
    await fs.mkdir(publicDestDir, { recursive: true });

    await setJobProgress(jobId, 45, "Generating voiceover…");
    const voiceover = await synthesizeVoiceover(scriptResult.script, publicDestDir, publicUrlPrefix, input.voice);

    await db.project.update({
      where: { id: project.id },
      data: {
        title: scriptResult.title,
        script: scriptResult.script,
        voiceoverUrl: voiceover.audioUrl,
        captionsJson: JSON.stringify(voiceover.words),
      },
    });

    await setJobProgress(jobId, 60, "Rendering video…");
    const outputPath = path.join(publicDestDir, "final.mp4");
    await renderScriptVideo(
      {
        words: voiceover.words,
        scenes,
        audioUrl: voiceover.audioUrl,
        durationInSeconds: voiceover.durationSec,
      },
      outputPath,
      (percent) => {
        // Map render progress (0-100) onto the remaining 60-95 job range.
        void setJobProgress(jobId, 60 + Math.round(percent * 0.35));
      }
    );

    const videoUrl = `${publicUrlPrefix}/final.mp4`;

    await db.project.update({
      where: { id: project.id },
      data: { status: "ready", videoUrl },
    });
    await db.job.update({ where: { id: jobId }, data: { status: "done", progress: 100, log: "Done" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    await db.project.update({ where: { id: project.id }, data: { status: "failed", errorMessage: message } });
    await db.job.update({ where: { id: jobId }, data: { status: "failed", log: message } });
  }
}
