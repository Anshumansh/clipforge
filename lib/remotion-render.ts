import path from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import type { ScriptVideoProps } from "@/remotion/ScriptVideo";
import type { RepurposeClipProps } from "@/remotion/RepurposeClip";
import type { AudioExtractProps } from "@/remotion/AudioExtract";

let bundlePromise: Promise<string> | null = null;

function getBundle() {
  if (!bundlePromise) {
    bundlePromise = bundle({
      entryPoint: path.join(process.cwd(), "remotion", "index.ts"),
      publicDir: path.join(process.cwd(), "public"),
      onProgress: () => {},
    });
  }
  return bundlePromise;
}

async function renderComposition(
  id: "ScriptVideo" | "RepurposeClip" | "AudioExtract",
  props: Record<string, unknown>,
  outputPath: string,
  codec: "h264" | "mp3",
  onProgress?: (percent: number) => void
) {
  const serveUrl = await getBundle();

  const composition = await selectComposition({ serveUrl, id, inputProps: props });

  await renderMedia({
    serveUrl,
    composition,
    codec,
    // "visually lossless" threshold for x264 (default ~23); only applies to the h264 codec.
    ...(codec === "h264" ? { crf: 18 } : {}),
    outputLocation: outputPath,
    inputProps: props,
    onProgress: ({ progress }) => onProgress?.(Math.round(progress * 100)),
  });

  return outputPath;
}

export function renderScriptVideo(props: ScriptVideoProps, outputPath: string, onProgress?: (percent: number) => void) {
  return renderComposition("ScriptVideo", props as unknown as Record<string, unknown>, outputPath, "h264", onProgress);
}

export function renderRepurposeClip(props: RepurposeClipProps, outputPath: string, onProgress?: (percent: number) => void) {
  return renderComposition("RepurposeClip", props as unknown as Record<string, unknown>, outputPath, "h264", onProgress);
}

/** Renders just the audio track through Remotion's real encoding pipeline (not a raw
 * remux), producing a standards-compliant mp3 any transcription API can decode. */
export function renderAudioExtract(props: AudioExtractProps, outputPath: string, onProgress?: (percent: number) => void) {
  return renderComposition("AudioExtract", props as unknown as Record<string, unknown>, outputPath, "mp3", onProgress);
}
