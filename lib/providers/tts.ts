import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseBuffer } from "music-metadata";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { withTimeout } from "@/lib/with-timeout";
import { uploadBuffer } from "@/lib/storage";
import { getLanguage } from "@/lib/languages";
import type { VoiceoverResult, WordTiming } from "./types";

const WORDS_PER_SECOND = 2.5;
const PROVIDER_TIMEOUT_MS = 20000;

// OpenAI-style aliases carry a rough gender lean, reused to pick which of a
// language's two Edge voices to use -- kept separate from OpenAI's own
// voice param (see synthesizeWithOpenAI) since these aren't valid OpenAI
// voice names once mapped through a non-English language.
const MALE_ALIASES = new Set(["alloy", "echo", "onyx"]);

function mapToEdgeVoice(voice: string | undefined, languageCode: string): string {
  if (voice && voice.includes("-Neural")) return voice; // already a literal Edge voice name
  const language = getLanguage(languageCode);
  return MALE_ALIASES.has(voice ?? "alloy") ? language.maleVoice : language.femaleVoice;
}

export function estimateWordTimings(script: string, totalDurationSec: number): WordTiming[] {
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

async function synthesizeWithOpenAI(script: string, mediaKeyPrefix: string, voice: string): Promise<VoiceoverResult> {
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
  const audioUrl = await uploadBuffer(buffer, `${mediaKeyPrefix}/voiceover.mp3`, "audio/mpeg");

  const metadata = await parseBuffer(buffer, "audio/mpeg");
  const durationSec = metadata.format.duration ?? script.split(/\s+/).length / WORDS_PER_SECOND;

  return {
    audioUrl,
    durationSec,
    words: estimateWordTimings(script, durationSec),
    mocked: false,
  };
}

/** Free, no-signup voiceover using Microsoft Edge's neural TTS voices (the engine behind
 * Edge's "Read Aloud"). Unofficial API, but widely used and reliable in practice. */
async function synthesizeWithEdge(
  script: string,
  mediaKeyPrefix: string,
  voice: string,
  languageCode: string
): Promise<VoiceoverResult> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipforge-tts-"));

  const tts = new MsEdgeTTS();
  try {
    await tts.setMetadata(mapToEdgeVoice(voice, languageCode), OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
    const { audioFilePath } = await tts.toFile(tempDir, script);

    const buffer = await fs.readFile(audioFilePath);
    const audioUrl = await uploadBuffer(buffer, `${mediaKeyPrefix}/voiceover.mp3`, "audio/mpeg");

    const metadata = await parseBuffer(buffer, "audio/mpeg");
    const durationSec = metadata.format.duration ?? script.split(/\s+/).length / WORDS_PER_SECOND;

    return {
      audioUrl,
      durationSec,
      words: estimateWordTimings(script, durationSec),
      mocked: false,
    };
  } finally {
    tts.close();
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function synthesizeVoiceover(
  script: string,
  mediaKeyPrefix: string,
  voice = "alloy",
  useFreeOnly = false,
  languageCode = "en"
): Promise<VoiceoverResult> {
  if (process.env.OPENAI_API_KEY && !useFreeOnly) {
    try {
      const result = await withTimeout(synthesizeWithOpenAI(script, mediaKeyPrefix, voice), PROVIDER_TIMEOUT_MS, "OpenAI TTS");
      return { ...result, provider: "openai" as const, characterCount: script.length };
    } catch (err) {
      console.error("[tts] OpenAI TTS failed, falling back:", err instanceof Error ? err.message : err);
    }
  }

  try {
    const result = await withTimeout(
      synthesizeWithEdge(script, mediaKeyPrefix, voice, languageCode),
      PROVIDER_TIMEOUT_MS,
      "Edge TTS"
    );
    return { ...result, provider: "edge" as const, characterCount: script.length };
  } catch (err) {
    console.error("[tts] Edge TTS failed:", err instanceof Error ? err.message : err);
    // All available providers have been exhausted. Throwing here propagates to
    // the job runner's catch block, which marks the job failed, surfaces an
    // error message to the user, and refunds their credits. Returning the mock
    // (audioUrl: null) instead would silently produce a soundless video while
    // still consuming credits.
    throw new Error("All TTS providers failed — voiceover could not be generated. Please try again.");
  }
}
