import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { renderAudioExtract } from "@/lib/remotion-render";

const MAX_WHISPER_BYTES = 24 * 1024 * 1024; // both providers cap around 25MB; leave headroom

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface Transcript {
  text: string;
  segments: TranscriptSegment[];
}

interface WhisperConfig {
  url: string;
  apiKey: string;
  model: string;
}

/** Both are tried in order (if configured) so a quota-exhausted OpenAI key doesn't
 * block falling through to a working free Groq key. */
function getWhisperConfigs(): WhisperConfig[] {
  const configs: WhisperConfig[] = [];
  if (process.env.OPENAI_API_KEY) {
    configs.push({ url: "https://api.openai.com/v1/audio/transcriptions", apiKey: process.env.OPENAI_API_KEY, model: "whisper-1" });
  }
  if (process.env.GROQ_API_KEY) {
    configs.push({
      url: "https://api.groq.com/openai/v1/audio/transcriptions",
      apiKey: process.env.GROQ_API_KEY,
      model: "whisper-large-v3",
    });
  }
  return configs;
}

async function tryTranscribe(config: WhisperConfig, buffer: Buffer, fileName: string): Promise<Transcript | null> {
  try {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(buffer)]), fileName);
    form.append("model", config.model);
    form.append("response_format", "verbose_json");

    const res = await fetch(config.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiKey}` },
      body: form,
      signal: AbortSignal.timeout(60000),
    });

    if (!res.ok) {
      console.error(`[transcription] ${config.url} failed: ${res.status} ${await res.text().catch(() => "")}`);
      return null;
    }

    const data = await res.json();
    const segments: TranscriptSegment[] = Array.isArray(data.segments)
      ? data.segments.map((s: { start: number; end: number; text: string }) => ({
          start: s.start,
          end: s.end,
          text: s.text.trim(),
        }))
      : [];

    return { text: data.text ?? "", segments };
  } catch (err) {
    console.error("[transcription] request threw:", err instanceof Error ? err.message : err);
    return null;
  }
}

async function transcribeAudioFile(audioPath: string): Promise<Transcript | null> {
  const configs = getWhisperConfigs();
  if (configs.length === 0) return null;

  const buffer = await fs.readFile(audioPath);
  if (buffer.byteLength > MAX_WHISPER_BYTES) return null;

  for (const config of configs) {
    const result = await tryTranscribe(config, buffer, path.basename(audioPath));
    if (result) return result;
  }
  return null;
}

/** Extracts the audio track by rendering it through Remotion's real encoding pipeline
 * (a raw container remux was unreliable — the source's AAC audio came out in a
 * nonstandard container no transcription API could decode), then transcribes it with
 * Whisper (OpenAI, then Groq's free-tier Whisper as a fallback). Returns null in mock
 * mode, on failure, or if the audio is too large for the API — callers should fall
 * back to duration-based logic. */
export async function transcribeVideo(sourcePath: string, durationSec: number): Promise<Transcript | null> {
  if (getWhisperConfigs().length === 0) return null;

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipforge-transcribe-"));
  const audioPath = path.join(tempDir, "audio-extract.mp3");

  try {
    await renderAudioExtract({ sourcePath, durationInSeconds: durationSec }, audioPath);
    const transcript = await transcribeAudioFile(audioPath);
    if (!transcript) console.error("[transcription] all configured providers returned no transcript");
    return transcript;
  } catch (err) {
    console.error("[transcription] extractAudio/transcribe pipeline threw:", err instanceof Error ? err.message : err);
    return null;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}
