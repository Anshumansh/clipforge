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

// The queue above is purely in-memory, so a deploy or crash mid-render orphans
// whatever was "queued"/"processing" at that instant — nothing is left to ever
// pick those jobs back up, and without this they'd spin in the UI forever. Since
// this runs once at process start (before enqueueJob has been called at all),
// anything already in one of these states in the DB is guaranteed to be from a
// previous process, not this one — safe to fail them outright rather than guess
// at resuming a render that's already gone.
async function reconcileOrphanedJobs() {
  const orphaned = await db.job.findMany({
    where: { status: { in: ["queued", "processing"] } },
    select: { id: true, projectId: true },
  });
  if (orphaned.length === 0) return;

  const message = "Interrupted by a server restart — please try again.";
  await db.job.updateMany({
    where: { id: { in: orphaned.map((j) => j.id) } },
    data: { status: "failed", log: message },
  });
  await db.project.updateMany({
    where: { id: { in: orphaned.map((j) => j.projectId) } },
    data: { status: "failed", errorMessage: message },
  });
  console.error(`[queue] reconciled ${orphaned.length} orphaned job(s) from a previous process`);
}

void reconcileOrphanedJobs().catch((err) => console.error("[queue] reconciliation failed:", err));

async function setQueuePosition(jobId: string, position: number) {
  const label = position === 0 ? "Up next…" : `Waiting in queue — ${position} ahead of you…`;
  await db.job.update({ where: { id: jobId }, data: { log: label } }).catch(() => {});
}

function pump() {
  console.error(`[queue] pump: active=${active} pending=${pending.length}`);
  if (active >= MAX_CONCURRENT_RENDERS) return;
  const next = pending.shift();
  if (!next) return;

  active++;
  console.error(`[queue] starting ${next.jobId}, active now ${active}`);
  pending.forEach((job, i) => void setQueuePosition(job.jobId, i));

  runnerFor(next.type)(next.jobId)
    .catch((err) => {
      console.error(`Job ${next.jobId} (${next.type}) crashed:`, err);
    })
    .finally(() => {
      active--;
      console.error(`[queue] finished ${next.jobId}, active now ${active}`);
      pump();
    });

  // A slot may still be free (e.g. right after startup) — keep draining.
  pump();
}

export function enqueueJob(jobId: string, type: JobType) {
  console.error(`[queue] enqueueJob ${jobId}, active=${active} pending-before=${pending.length}`);
  pending.push({ jobId, type });
  if (pending.length > 1 || active >= MAX_CONCURRENT_RENDERS) {
    void setQueuePosition(jobId, pending.length - 1);
  }
  pump();
}
