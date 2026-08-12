import { db } from "@/lib/db";
import { renderRepurposeClip } from "@/lib/remotion-render";
import { transcribeVideo } from "@/lib/providers/transcription";
import { planHighlightsFromTranscript, type HighlightClip } from "@/lib/providers/highlights";
import { chatJSON } from "@/lib/providers/llm";
import { analyzeSubjectPan, prepareLocalSource } from "@/lib/providers/subject-tracking";
import { recordActivity } from "@/lib/streaks";
import { getBrandForRender } from "@/lib/brand-server";
import { refundCredits, CREDITS_PER_VIDEO } from "@/lib/credits";
import { captureReservationInTx, releaseReservationInTx } from "@/lib/pricing/ledger";
import { resolveProjectCreditOwnerId } from "@/lib/workspace";
import { upsertCostRecord } from "@/lib/jobs/cost-tracker";
import type { AspectRatio } from "@/lib/aspect-ratio";

async function setJobProgress(jobId: string, progress: number, log?: string) {
  await db.job.update({ where: { id: jobId }, data: { progress, ...(log ? { log } : {}) } });
}

async function findReservationId(jobId: string): Promise<string | null> {
  const res = await db.creditReservation.findUnique({ where: { jobId } }).catch(() => null);
  return res?.id ?? null;
}

function planSegmentsByDuration(durationSec: number): HighlightClip[] {
  const count = Math.min(4, Math.max(1, Math.floor(durationSec / 25)));
  const clipLength = Math.min(45, Math.max(15, durationSec / count - 2));
  const segments: HighlightClip[] = [];

  for (let i = 0; i < count; i++) {
    const slot = durationSec / count;
    const start = i * slot + Math.max(0, (slot - clipLength) / 2);
    const end = Math.min(start + clipLength, durationSec - 0.2);
    if (end - start >= 5) segments.push({ startSec: start, endSec: end, title: `Highlight ${i + 1}`, score: 50 });
  }

  return segments.length > 0
    ? segments
    : [{ startSec: 0, endSec: Math.min(durationSec, 15), title: "Highlight 1", score: 50 }];
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
  const job = await db.job.findUniqueOrThrow({ where: { id: jobId }, include: { project: { include: { user: true } } } });
  const project = job.project;

  try {
    await db.job.update({ where: { id: jobId }, data: { status: "processing", progress: 5 } });
    await db.project.update({ where: { id: project.id }, data: { status: "processing" } });

    const input = JSON.parse(project.input) as {
      durationSec: number;
      sourcePath: string;
      topic: string;
      aspectRatio?: AspectRatio;
    };
    const mediaKeyPrefix = `media/${project.userId}/${project.id}`;

    await setJobProgress(jobId, 10, "Transcribing audio…");
    const transcript = await transcribeVideo(input.sourcePath, input.durationSec);

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
      plan.map((seg) =>
        db.clip.create({
          data: {
            projectId: project.id,
            title: seg.title,
            startSec: seg.startSec,
            endSec: seg.endSec,
            score: seg.score,
            status: "pending",
          },
        })
      )
    );

    await setJobProgress(jobId, 22, "Preparing for subject tracking…");
    const { localPath: localSourcePath, cleanup: cleanupLocalSource } = await prepareLocalSource(input.sourcePath).catch(
      (err) => {
        console.error("[repurpose] could not download source for tracking:", err instanceof Error ? err.message : err);
        return { localPath: null as string | null, cleanup: async () => {} };
      }
    );

    const brand = await getBrandForRender(project.userId);

    let completed = 0;
    let totalRenderSeconds = 0;
    for (const clip of clips) {
      await db.clip.update({ where: { id: clip.id }, data: { status: "processing" } });
      try {
        await setJobProgress(jobId, Math.round(25 + (completed / clips.length) * 70), "Tracking subject…");
        const panKeyframes = localSourcePath
          ? await analyzeSubjectPan(localSourcePath, clip.startSec, clip.endSec).catch((err) => {
              console.error("[repurpose] subject tracking failed, using center crop:", err instanceof Error ? err.message : err);
              return null;
            })
          : null;

        const clipRenderStart = Date.now();
        const videoUrl = await renderRepurposeClip(
          {
            sourcePath: input.sourcePath,
            startSec: clip.startSec,
            endSec: clip.endSec,
            title: clip.title,
            aspectRatio: input.aspectRatio,
            panKeyframes: panKeyframes ?? undefined,
            brand,
          },
          `${mediaKeyPrefix}/clip-${clip.id}.mp4`,
          (percent) => {
            const overallPercent = 25 + ((completed + percent / 100) / clips.length) * 70;
            void setJobProgress(jobId, Math.round(overallPercent));
          }
        );
        totalRenderSeconds += (Date.now() - clipRenderStart) / 1000;
        await db.clip.update({ where: { id: clip.id }, data: { status: "ready", videoUrl } });
      } catch {
        await db.clip.update({ where: { id: clip.id }, data: { status: "failed" } });
      }
      completed += 1;
    }

    await cleanupLocalSource();

    const readyClips = await db.clip.count({ where: { projectId: project.id, status: "ready" } });
    if (readyClips === 0) {
      throw new Error("All clip renders failed");
    }

    // Project "ready", Job "done", and the reservation capture must land
    // together or not at all -- see the identical comment in
    // lib/jobs/script-runner.ts and captureReservationInTx in
    // lib/pricing/ledger.ts.
    const reservationId = await findReservationId(jobId);
    await db.$transaction(async (tx) => {
      await tx.project.update({ where: { id: project.id }, data: { status: "ready" } });
      await tx.job.update({ where: { id: jobId }, data: { status: "done", progress: 100, log: "Done" } });
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
      transcriptionSeconds: input.durationSec,
      renderSeconds: totalRenderSeconds,
      creditsCharged: CREDITS_PER_VIDEO,
    }).catch((e) => console.error("[repurpose-runner] cost record write failed:", e instanceof Error ? e.message : e));

    await recordActivity(project.userId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const reservationId = await findReservationId(jobId).catch(() => null);

    if (reservationId) {
      // Atomic failure finalization -- see the identical comment in
      // lib/jobs/script-runner.ts and releaseReservationInTx in
      // lib/pricing/ledger.ts.
      await db
        .$transaction(async (tx) => {
          await tx.project.update({ where: { id: project.id }, data: { status: "failed", errorMessage: message } });
          await tx.job.update({ where: { id: jobId }, data: { status: "failed", log: message } });
          await releaseReservationInTx(tx, reservationId, message);
        })
        .catch((e) => {
          console.error(
            "[repurpose-runner] atomic failure finalization failed -- job remains recoverable as processing/reserved:",
            e instanceof Error ? e.message : e
          );
        });
    } else {
      // Legacy/demo fallback -- see the identical comment in
      // lib/jobs/script-runner.ts.
      await db.project.update({ where: { id: project.id }, data: { status: "failed", errorMessage: message } });
      await db.job.update({ where: { id: jobId }, data: { status: "failed", log: message } });
      const creditOwnerId = await resolveProjectCreditOwnerId(project).catch(() => project.userId);
      await refundCredits(creditOwnerId, CREDITS_PER_VIDEO).catch((e) =>
        console.error("[repurpose-runner] legacy credit refund failed:", e instanceof Error ? e.message : e)
      );
    }

    await upsertCostRecord({
      jobId,
      projectId: project.id,
      userId: project.userId,
      creditsRefunded: CREDITS_PER_VIDEO,
    }).catch(() => {});
  }
}
