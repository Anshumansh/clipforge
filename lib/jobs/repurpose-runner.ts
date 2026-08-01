import path from "node:path";
import { db } from "@/lib/db";
import { renderRepurposeClip } from "@/lib/remotion-render";
import { transcribeVideo } from "@/lib/providers/transcription";
import { planHighlightsFromTranscript, type HighlightClip } from "@/lib/providers/highlights";
import { chatJSON } from "@/lib/providers/llm";

async function setJobProgress(jobId: string, progress: number, log?: string) {
  await db.job.update({ where: { id: jobId }, data: { progress, ...(log ? { log } : {}) } });
}

function planSegmentsByDuration(durationSec: number): HighlightClip[] {
  const count = Math.min(4, Math.max(1, Math.floor(durationSec / 25)));
  const clipLength = Math.min(45, Math.max(15, durationSec / count - 2));
  const segments: HighlightClip[] = [];

  for (let i = 0; i < count; i++) {
    const slot = durationSec / count;
    const start = i * slot + Math.max(0, (slot - clipLength) / 2);
    const end = Math.min(start + clipLength, durationSec - 0.2);
    if (end - start >= 5) segments.push({ startSec: start, endSec: end, title: `Highlight ${i + 1}` });
  }

  return segments.length > 0 ? segments : [{ startSec: 0, endSec: Math.min(durationSec, 15), title: "Highlight 1" }];
}

async function generateTitlesForSegments(topic: string, count: number): Promise<string[]> {
  const fallback = Array.from({ length: count }, (_, i) => `Highlight ${i + 1}`);

  const parsed = await chatJSON(
    [
      {
        role: "system",
        content:
          `Given the topic of a long-form video, invent ${count} punchy, clickbait-free short-form clip titles ` +
          `(max 6 words each) that could plausibly be highlight moments from it. Return strict JSON: {"titles": string[]}.`,
      },
      { role: "user", content: `Video topic: ${topic}` },
    ],
    0.9
  );

  if (parsed && Array.isArray(parsed.titles) && parsed.titles.length >= count) {
    return (parsed.titles as string[]).slice(0, count);
  }
  return fallback;
}

export async function runRepurposeJob(jobId: string) {
  const job = await db.job.findUniqueOrThrow({ where: { id: jobId }, include: { project: true } });
  const project = job.project;

  try {
    await db.job.update({ where: { id: jobId }, data: { status: "processing", progress: 5 } });
    await db.project.update({ where: { id: project.id }, data: { status: "processing" } });

    const input = JSON.parse(project.input) as { durationSec: number; sourcePath: string; topic: string };
    const publicDestDir = path.join(process.cwd(), "public", "media", project.userId, project.id);
    const publicUrlPrefix = `/media/${project.userId}/${project.id}`;

    await setJobProgress(jobId, 10, "Transcribing audio…");
    const transcript = await transcribeVideo(input.sourcePath, input.durationSec, publicDestDir);

    let highlights: HighlightClip[] | null = null;
    if (transcript) {
      await db.project.update({ where: { id: project.id }, data: { script: transcript.text.slice(0, 20000) } });
      await setJobProgress(jobId, 20, "Finding highlight moments…");
      highlights = await planHighlightsFromTranscript(transcript, input.durationSec, input.topic || project.title);
    }

    let plan: HighlightClip[];
    if (highlights && highlights.length > 0) {
      plan = highlights;
    } else {
      await setJobProgress(jobId, 20, "Planning highlight segments…");
      const segments = planSegmentsByDuration(input.durationSec);
      const titles = await generateTitlesForSegments(input.topic || project.title, segments.length);
      plan = segments.map((s, i) => ({ ...s, title: titles[i] ?? s.title }));
    }

    const clips = await Promise.all(
      plan.map((seg, i) =>
        db.clip.create({
          data: {
            projectId: project.id,
            title: seg.title,
            startSec: seg.startSec,
            endSec: seg.endSec,
            score: 1 - i * 0.1,
            status: "pending",
          },
        })
      )
    );

    let completed = 0;
    for (const clip of clips) {
      await db.clip.update({ where: { id: clip.id }, data: { status: "processing" } });
      try {
        const outputPath = path.join(publicDestDir, `clip-${clip.id}.mp4`);
        await renderRepurposeClip(
          {
            sourcePath: input.sourcePath,
            startSec: clip.startSec,
            endSec: clip.endSec,
            title: clip.title,
          },
          outputPath,
          (percent) => {
            const overallPercent = 25 + ((completed + percent / 100) / clips.length) * 70;
            void setJobProgress(jobId, Math.round(overallPercent));
          }
        );
        await db.clip.update({
          where: { id: clip.id },
          data: { status: "ready", videoUrl: `${publicUrlPrefix}/clip-${clip.id}.mp4` },
        });
      } catch {
        await db.clip.update({ where: { id: clip.id }, data: { status: "failed" } });
      }
      completed += 1;
    }

    const readyClips = await db.clip.count({ where: { projectId: project.id, status: "ready" } });

    if (readyClips === 0) {
      throw new Error("All clip renders failed");
    }

    await db.project.update({ where: { id: project.id }, data: { status: "ready" } });
    await db.job.update({ where: { id: jobId }, data: { status: "done", progress: 100, log: "Done" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    await db.project.update({ where: { id: project.id }, data: { status: "failed", errorMessage: message } });
    await db.job.update({ where: { id: jobId }, data: { status: "failed", log: message } });
  }
}
