import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import { uploadLocalFile, getAppBaseUrl, getPresignedDownloadUrl } from "@/lib/storage";
import { db } from "@/lib/db";
import { validateExternalAssetUrl } from "@/lib/asset-url-security";
import type { ScriptVideoProps } from "@/remotion/ScriptVideo";
import type { RepurposeClipProps } from "@/remotion/RepurposeClip";
import type { AudioExtractProps } from "@/remotion/AudioExtract";
import type { ThumbnailProps } from "@/remotion/Thumbnail";

let bundlePromise: Promise<string> | null = null;

// Every uploaded asset's stored URL is `${getAppBaseUrl()}/api/media/{key}` --
// correct for a real user's own browser (goes through /api/media's per-user
// ownership check) but not fetchable by Remotion's renderer: that request
// runs inside headless Chrome with no session cookie and no route in to the
// internal-secret bypass (that's only wired up for the Repurpose subject-
// tracking path, see lib/providers/subject-tracking.ts). Every other render
// type 404'd trying to re-fetch its own just-uploaded voiceover/b-roll --
// silently for the demo account (its media is public by design) and loudly
// for everyone else. Reproduced live against the real admin account's one
// production render (job cmsvtahal00094ed4wmatbdi8, 2026-08-16): failed at
// 60% with exactly this 404.
//
// Fixed here, once, for every render type, rather than in each runner: swap
// the app URL for a short-lived presigned storage URL right before handing
// props to Remotion. This runs server-side in the same trusted process that
// already generates presigned URLs for the real /api/media route, so it
// doesn't need the app's own auth layer at all.
const MEDIA_ROUTE_PREFIX = `${getAppBaseUrl()}/api/media/`;

/** Every prop that reaches here today is already scoped to the current job's
 * own user by construction -- runners never forward a raw user-supplied URL
 * string into render props, only server-built paths keyed off the
 * authenticated session's own userId (verified directly: script/repurpose/UGC
 * all build their input asset keys server-side from `project.userId`, never
 * from user-suppliable request fields). This check doesn't rely on that
 * holding forever, though -- it's cheap insurance against a future prop
 * quietly becoming user-controllable (e.g. a raw pasted URL field) and
 * silently gaining the ability to have this process presign and hand
 * another account's private media to Remotion. Keys that don't parse into a
 * recognized shape, or that resolve to a different owner, are left
 * unresolved -- same as an untrusted request today, they fall through to the
 * real /api/media route and get its normal 404, not a working presigned URL. */
async function resolveExpectedOwnerUserId(storageKey: string): Promise<string | null> {
  const mediaMatch = storageKey.match(/^media\/([^/]+)\//);
  if (mediaMatch) return mediaMatch[1];

  const jobsMatch = storageKey.match(/^jobs\/([^/]+)\//);
  if (jobsMatch) {
    const job = await db.job.findUnique({ where: { id: jobsMatch[1] }, select: { userId: true } });
    return job?.userId ?? null;
  }

  return null;
}

export async function resolveInternalMediaUrls<T>(value: T, expectedUserId: string | null): Promise<T> {
  if (typeof value === "string") {
    if (value.startsWith(MEDIA_ROUTE_PREFIX)) {
      const key = value.slice(MEDIA_ROUTE_PREFIX.length);

      const owner = await resolveExpectedOwnerUserId(key);
      if (!expectedUserId || !owner || owner !== expectedUserId) return value;

      const presigned = await getPresignedDownloadUrl(key);
      // null in local dev (no STORAGE_* configured) -- falls back to the
      // ./public/media path Remotion's staticFile() already handles.
      return (presigned ?? value) as unknown as T;
    }

    // Not our own media route -- if it's URL-shaped at all, it's about to be
    // handed to Remotion's own server-side fetch (see asset-url-security.ts
    // for why "just pass it through" is an SSRF primitive, not a no-op).
    // Plain non-URL strings (topic text, aspect ratios, titles, ...) are
    // untouched -- they were never going anywhere near a network request.
    if (/^https?:\/\//i.test(value)) {
      return (await validateExternalAssetUrl(value)) as unknown as T;
    }
    return value;
  }
  if (Array.isArray(value)) {
    return (await Promise.all(value.map((v) => resolveInternalMediaUrls(v, expectedUserId)))) as unknown as T;
  }
  if (value && typeof value === "object") {
    const entries = await Promise.all(
      Object.entries(value).map(async ([k, v]) => [k, await resolveInternalMediaUrls(v, expectedUserId)] as const)
    );
    return Object.fromEntries(entries) as T;
  }
  return value;
}

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
  expectedUserId: string | null,
  onProgress?: (percent: number) => void
) {
  const serveUrl = await getBundle();
  const resolvedProps = await resolveInternalMediaUrls(props, expectedUserId);

  const composition = await selectComposition({ serveUrl, id, inputProps: resolvedProps });

  await renderMedia({
    serveUrl,
    composition,
    codec,
    // "visually lossless" threshold for x264 (default ~23); only applies to the h264 codec.
    ...(codec === "h264" ? { crf: 18 } : {}),
    outputLocation: outputPath,
    inputProps: resolvedProps,
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
    const expectedUserId = await resolveExpectedOwnerUserId(storageKey);
    await renderToLocalFile(id, props, tempPath, "h264", expectedUserId, onProgress);
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
 * caller right after transcription), so it never touches remote storage.
 * userId is the current job's own owner, used only to authorize resolving the
 * source video's URL into a presigned one (see resolveExpectedOwnerUserId) --
 * never persisted, never part of the output. */
export function renderAudioExtract(
  props: AudioExtractProps,
  localOutputPath: string,
  userId: string,
  onProgress?: (percent: number) => void
) {
  return renderToLocalFile("AudioExtract", props as unknown as Record<string, unknown>, localOutputPath, "mp3", userId, onProgress);
}

/** Renders a single still frame (YouTube thumbnail size) and uploads it —
 * a real image composite (background photo + title text), not a paid
 * generative-image API call. renderStill is a separate, much cheaper
 * Remotion API than renderMedia: one frame, no encoding. */
export async function renderThumbnail(props: ThumbnailProps, storageKey: string): Promise<string> {
  const serveUrl = await getBundle();
  const expectedUserId = await resolveExpectedOwnerUserId(storageKey);
  const resolvedProps = await resolveInternalMediaUrls(props as unknown as Record<string, unknown>, expectedUserId);
  const composition = await selectComposition({
    serveUrl,
    id: "Thumbnail",
    inputProps: resolvedProps,
  });

  const tempPath = path.join(os.tmpdir(), `clipforge-thumb-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`);
  try {
    await renderStill({
      serveUrl,
      composition,
      output: tempPath,
      inputProps: resolvedProps,
      imageFormat: "jpeg",
      jpegQuality: 90,
    });
    return await uploadLocalFile(tempPath, storageKey, "image/jpeg");
  } finally {
    await fs.rm(tempPath, { force: true }).catch(() => {});
  }
}
