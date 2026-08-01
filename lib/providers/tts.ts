import fs from "node:fs/promises";
import path from "node:path";
import { parseBuffer } from "music-metadata";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { withTimeout } from "@/lib/with-timeout";
import type { VoiceoverResult, WordTiming } from "./types";

const WORDS_PER_SECOND = 2.5;
const PROVIDER_TIMEOUT_MS = 20000;

const EDGE_VOICES: Record<string, string> = {
  alloy: "en-US-GuyNeural",
  echo: "en-US-GuyNeural",
  onyx: "en-US-DavisNeural",
  nova: "en-US-JennyNeural",
  shimmer: "en-US-AriaNeural",
  fable: "en-US-JennyNeural",
};

function mapToEdgeVoice(voice?: string): string {
  if (voice && voice.includes("-Neural")) return voice; // already an Edge voice name
  return (voice && EDGE_VOICES[voice]) || "en-US-GuyNeural";
}

function estimateWordTimings(script: string, totalDurationSec: number): WordTiming[] {
  const words = script.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  // Distribute time proportionally to word length so short words like "a" get less airtime.
  const weights = words.map((w) => Math.max(w.length, 2));
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  let cursor = 0;
  return words.map((word, i) => {
    const duration = (weights[i] / totalWeight) * totalDurationSec;
    const start = cursor;
    const end = cursor + duration;
    cursor = end;
    return { word, start, end };
  });
}

function mockVoiceover(script: string): VoiceoverResult {
  const wordCount = script.split(/\s+/).filter(Boolean).length;
  const durationSec = Math.max(wordCount / WORDS_PER_SECOND, 3);
  return {
    audioUrl: null,
    durationSec,
    words: estimateWordTimings(script, durationSec),
    mocked: true,
  };
}

async function synthesizeWithOpenAI(
  script: string,
  publicDestDir: string,
  publicUrlPrefix: string,
  voice: string
): Promise<VoiceoverResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");

  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model: "tts-1", voice, input: script, response_format: "mp3" }),
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });

  if (!res.ok) throw new Error(`OpenAI TTS failed: ${res.status}`);

  const buffer = Buffer.from(await res.arrayBuffer());
  await fs.mkdir(publicDestDir, { recursive: true });
  await fs.writeFile(path.join(publicDestDir, "voiceover.mp3"), buffer);

  const metadata = await parseBuffer(buffer, "audio/mpeg");
  const durationSec = metadata.format.duration ?? script.split(/\s+/).length / WORDS_PER_SECOND;

  return {
    audioUrl: `${publicUrlPrefix}/voiceover.mp3`,
    durationSec,
    words: estimateWordTimings(script, durationSec),
    mocked: false,
  };
}

/** Free, no-signup voiceover using Microsoft Edge's neural TTS voices (the engine behind
 * Edge's "Read Aloud"). Unofficial API, but widely used and reliable in practice. */
async function synthesizeWithEdge(
  script: string,
  publicDestDir: string,
  publicUrlPrefix: string,
  voice: string
): Promise<VoiceoverResult> {
  await fs.mkdir(publicDestDir, { recursive: true });

  const tts = new MsEdgeTTS();
  try {
    await tts.setMetadata(mapToEdgeVoice(voice), OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
    const { audioFilePath } = await tts.toFile(publicDestDir, script);

    const finalPath = path.join(publicDestDir, "voiceover.mp3");
    if (path.resolve(audioFilePath) !== path.resolve(finalPath)) {
      await fs.rename(audioFilePath, finalPath);
    }

    const buffer = await fs.readFile(finalPath);
    const metadata = await parseBuffer(buffer, "audio/mpeg");
    const durationSec = metadata.format.duration ?? script.split(/\s+/).length / WORDS_PER_SECOND;

    return {
      audioUrl: `${publicUrlPrefix}/voiceover.mp3`,
      durationSec,
      words: estimateWordTimings(script, durationSec),
      mocked: false,
    };
  } finally {
    tts.close();
  }
}

export async function synthesizeVoiceover(
  script: string,
  publicDestDir: string,
  publicUrlPrefix: string,
  voice = "alloy"
): Promise<VoiceoverResult> {
  if (process.env.OPENAI_API_KEY) {
    try {
      return await withTimeout(synthesizeWithOpenAI(script, publicDestDir, publicUrlPrefix, voice), PROVIDER_TIMEOUT_MS, "OpenAI TTS");
    } catch (err) {
      console.error("[tts] OpenAI TTS failed, falling back:", err instanceof Error ? err.message : err);
    }
  }

  try {
    return await withTimeout(synthesizeWithEdge(script, publicDestDir, publicUrlPrefix, voice), PROVIDER_TIMEOUT_MS, "Edge TTS");
  } catch (err) {
    console.error("[tts] Edge TTS failed, falling back to mock:", err instanceof Error ? err.message : err);
    return mockVoiceover(script);
  }
}
