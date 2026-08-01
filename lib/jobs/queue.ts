import { runScriptJob } from "./script-runner";
import { runRepurposeJob } from "./repurpose-runner";
import { runUgcJob } from "./ugc-runner";

export function enqueueJob(jobId: string, type: "script" | "repurpose" | "ugc") {
  const runner = type === "script" ? runScriptJob : type === "repurpose" ? runRepurposeJob : runUgcJob;

  // Fire-and-forget in-process execution. Good enough for a single-instance MVP;
  // swap for a real queue (BullMQ, etc.) once running multiple server instances.
  void runner(jobId).catch((err) => {
    console.error(`Job ${jobId} (${type}) crashed:`, err);
  });
}
