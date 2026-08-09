import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import { uploadLocalFile } from "@/lib/storage";
import type { ScriptVideoProps } from "@/remotion/ScriptVideo";
import type { RepurposeClipProps } from "@/remotion/RepurposeClip";
import type { AudioExtractProps } from "@/remotion/AudioExtract";
import type { ThumbnailProps } from "@/remotion/Thumbnail";

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

async function renderToLocalFile(
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

/** Renders a composition to a local temp file, uploads it to storage (S3/R2 in
 * production, ./public/media locally), then cleans up the temp file. Returns the
 * final public URL. Rendering can't target storage directly — Remotion needs a
 * real local path to write frames/encoded output to. */
async function renderAndUpload(
  id: "ScriptVideo" | "RepurposeClip",
  props: Record<string, unknown>,
  storageKey: string,
  onProgress?: (percent: number) => void
) {
  const tempPath = path.join(os.tmpdir(), `clipforge-render-${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`);

  try {
    await renderToLocalFile(id, props, tempPath, "h264", onProgress);
    return await uploadLocalFile(tempPath, storageKey, "video/mp4");
  } finally {
    await fs.rm(tempPath, { force: true }).catch(() => {});
  }
}

export function renderScriptVideo(
  props: ScriptVideoProps,
  storageKey: string,
  onProgress?: (percent: number) => void
) {
  return renderAndUpload("ScriptVideo", props as unknown as Record<string, unknown>, storageKey, onProgress);
}

export function renderRepurposeClip(
  props: RepurposeClipProps,
  storageKey: string,
  onProgress?: (percent: number) => void
) {
  return renderAndUpload("RepurposeClip", props as unknown as Record<string, unknown>, storageKey, onProgress);
}

/** Renders just the audio track through Remotion's real encoding pipeline (not a raw
 * remux), producing a standards-compliant mp3 any transcription API can decode.
 * Writes to the given local path directly — this output is transient (deleted by the
 * caller right after transcription), so it never touches remote storage. */
export function renderAudioExtract(props: AudioExtractProps, localOutputPath: string, onProgress?: (percent: number) => void) {
  return renderToLocalFile("AudioExtract", props as unknown as Record<string, unknown>, localOutputPath, "mp3", onProgress);
}

/** Renders a single still frame (YouTube thumbnail size) and uploads it —
 * a real image composite (background photo + title text), not a paid
 * generative-image API call. renderStill is a separate, much cheaper
 * Remotion API than renderMedia: one frame, no encoding. */
export async function renderThumbnail(props: ThumbnailProps, storageKey: string): Promise<string> {
  const serveUrl = await getBundle();
  const composition = await selectComposition({
    serveUrl,
    id: "Thumbnail",
    inputProps: props as unknown as Record<string, unknown>,
  });

  const tempPath = path.join(os.tmpdir(), `clipforge-thumb-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`);
  try {
    await renderStill({
      serveUrl,
      composition,
      output: tempPath,
      inputProps: props as unknown as Record<string, unknown>,
      imageFormat: "jpeg",
      jpegQuality: 90,
    });
    return await uploadLocalFile(tempPath, storageKey, "image/jpeg");
  } finally {
    await fs.rm(tempPath, { force: true }).catch(() => {});
  }
}
