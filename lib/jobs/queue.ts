import { db } from "@/lib/db";
import { runScriptJob } from "./script-runner";
import { runRepurposeJob } from "./repurpose-runner";
import { runUgcJob } from "./ugc-runner";

type JobType = "script" | "repurpose" | "ugc";

// Measured on the production VPS (4 vCPU / 7.6GB): a single render peaks around
// 3.3GB RAM and pins nearly all 4 cores (headless Chrome + ffmpeg). Two concurrent
// renders (~6.6GB) leaves enough headroom for the app/DB/Caddy; a third risked OOM.
// This is an in-process semaphore — fine for one server instance, but it means
// rate limiting and queueing both reset on deploy and don't coordinate across
// multiple instances. Move to a real queue (BullMQ + Redis) before scaling out.
const MAX_CONCURRENT_RENDERS = 2;

let active = 0;
const pending: Array<{ jobId: string; type: JobType }> = [];

function runnerFor(type: JobType) {
  return type === "script" ? runScriptJob : type === "repurpose" ? runRepurposeJob : runUgcJob;
}

async function setQueuePosition(jobId: string, position: number) {
  const label = position === 0 ? "Up next…" : `Waiting in queue — ${position} ahead of you…`;
  await db.job.update({ where: { id: jobId }, data: { log: label } }).catch(() => {});
}

function pump() {
  if (active >= MAX_CONCURRENT_RENDERS) return;
  const next = pending.shift();
  if (!next) return;

  active++;
  pending.forEach((job, i) => void setQueuePosition(job.jobId, i));

  runnerFor(next.type)(next.jobId)
    .catch((err) => {
      console.error(`Job ${next.jobId} (${next.type}) crashed:`, err);
    })
    .finally(() => {
      active--;
      pump();
    });

  // A slot may still be free (e.g. right after startup) — keep draining.
  pump();
}

export function enqueueJob(jobId: string, type: JobType) {
  pending.push({ jobId, type });
  if (pending.length > 1 || active >= MAX_CONCURRENT_RENDERS) {
    void setQueuePosition(jobId, pending.length - 1);
  }
  pump();
}
