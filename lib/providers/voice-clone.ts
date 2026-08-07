import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseBuffer } from "music-metadata";
import { uploadBuffer } from "@/lib/storage";
import { estimateWordTimings } from "./tts";
import type { VoiceoverResult } from "./types";

const execFileAsync = promisify(execFile);

// Generous ceiling: model load is ~15-20s and CPU synthesis runs at roughly
// real-time (measured RTF ~0.2-1.0), so even a long script has headroom.
const CLONE_TIMEOUT_MS = 180_000;
const CLONE_SCRIPT_PATH = "/app/voice-clone/clone.py";

async function downloadToFile(url: string, destPath: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download reference voice sample: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(destPath, buffer);
}

/** Clones a voice from a short reference sample and synthesizes `text` in that
 * voice, via Coqui YourTTS running as an on-demand subprocess (see clone.py) —
 * the model only occupies memory for the duration of this call, not 24/7. */
export async function cloneVoice(
  referenceAudioUrl: string,
  text: string,
  mediaKeyPrefix: string
): Promise<VoiceoverResult> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipforge-voiceclone-"));
  const ext = path.extname(new URL(referenceAudioUrl).pathname) || ".mp3";
  const referencePath = path.join(tempDir, `reference${ext}`);
  const outputPath = path.join(tempDir, "output.wav");

  try {
    await downloadToFile(referenceAudioUrl, referencePath);

    // Args passed as an array, never interpolated into a shell string, so
    // user-supplied script text can't be interpreted as shell syntax.
    await execFileAsync("python3", [CLONE_SCRIPT_PATH, referencePath, text, outputPath], {
      timeout: CLONE_TIMEOUT_MS,
    });

    const buffer = await fs.readFile(outputPath);
    const audioUrl = await uploadBuffer(buffer, `${mediaKeyPrefix}/voiceover.wav`, "audio/wav");

    const metadata = await parseBuffer(buffer, "audio/wav");
    const durationSec = metadata.format.duration ?? text.split(/\s+/).filter(Boolean).length / 2.5;

    return {
      audioUrl,
      durationSec,
      words: estimateWordTimings(text, durationSec),
      mocked: false,
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}
