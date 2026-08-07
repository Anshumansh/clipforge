import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Sampled (not per-render-frame) face tracking, entirely free/local: BlazeFace
// running on TensorFlow.js's WASM backend — no native bindings (keeps the Docker
// image simple), no GPU, no external API. One frame per second is analyzed to
// build a smoothed horizontal pan path; the actual render still only needs the
// resulting keyframe list, not the ML stack itself.

export interface PanKeyframe {
  t: number; // seconds, relative to clip start
  xPercent: number; // 0-100, maps directly to CSS object-position X
}

const SAMPLE_INTERVAL_SEC = 1;
const SMOOTHING_WINDOW = 3;

let tfReady: Promise<typeof import("@tensorflow/tfjs-core")> | null = null;
let modelPromise: ReturnType<typeof loadModel> | null = null;

async function loadModel() {
  const tf = await import("@tensorflow/tfjs-core");
  await import("@tensorflow/tfjs-converter");
  const wasm = await import("@tensorflow/tfjs-backend-wasm");

  // The WASM binary ships inside the npm package itself — point the loader at
  // it explicitly so it doesn't try (and fail) to fetch from a CDN at runtime.
  // Built as a plain path.join rather than require.resolve(): webpack statically
  // parses require.resolve() targets even for externalized packages, and chokes
  // trying to parse the raw .wasm binary as a JS module.
  const wasmDir = path.join(process.cwd(), "node_modules", "@tensorflow", "tfjs-backend-wasm", "wasm-out");
  wasm.setWasmPaths(wasmDir + path.sep);

  await tf.setBackend("wasm");
  await tf.ready();

  const blazeface = await import("@tensorflow-models/blazeface");
  return blazeface.load();
}

function getTf() {
  if (!tfReady) tfReady = import("@tensorflow/tfjs-core");
  return tfReady;
}

function getModel() {
  if (!modelPromise) modelPromise = loadModel();
  return modelPromise;
}

function getFfmpegPath(): string {
  const pkg = process.platform === "win32" ? "@remotion/compositor-win32-x64-msvc" : "@remotion/compositor-linux-x64-gnu";
  const bin = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  return path.join(process.cwd(), "node_modules", pkg, bin);
}

async function extractSampleFrames(sourcePath: string, startSec: number, endSec: number, tempDir: string): Promise<string[]> {
  const duration = endSec - startSec;
  const pattern = path.join(tempDir, "frame-%04d.jpg");

  await execFileAsync(getFfmpegPath(), [
    "-ss", String(startSec),
    "-i", sourcePath,
    "-t", String(duration),
    // Remotion's bundled ffmpeg is a minimal build without the `fps` filter
    // compiled in — `-r` as a plain output-rate option achieves the same frame
    // sampling without touching the filtergraph.
    "-r", String(1 / SAMPLE_INTERVAL_SEC),
    "-q:v", "4",
    pattern,
  ]);

  const files = await fs.readdir(tempDir);
  return files
    .filter((f) => f.startsWith("frame-"))
    .sort()
    .map((f) => path.join(tempDir, f));
}

async function detectFaceCenterX(framePath: string): Promise<number | null> {
  const tf = await getTf();
  const model = await getModel();
  const jpeg = await import("jpeg-js");

  const buffer = await fs.readFile(framePath);
  const decoded = jpeg.decode(buffer, { useTArray: true });

  // jpeg-js decodes to RGBA; blazeface expects RGB.
  const rgb = new Int32Array(decoded.width * decoded.height * 3);
  for (let i = 0, j = 0; i < decoded.data.length; i += 4, j += 3) {
    rgb[j] = decoded.data[i];
    rgb[j + 1] = decoded.data[i + 1];
    rgb[j + 2] = decoded.data[i + 2];
  }

  const tensor = tf.tensor3d(rgb, [decoded.height, decoded.width, 3], "int32");
  try {
    const predictions = await model.estimateFaces(tensor as never, false);
    if (predictions.length === 0) return null;

    // Largest face wins (most likely the on-camera speaker, not a background face).
    let best = predictions[0];
    let bestArea = 0;
    for (const p of predictions) {
      const tl = p.topLeft as [number, number];
      const br = p.bottomRight as [number, number];
      const area = Math.abs((br[0] - tl[0]) * (br[1] - tl[1]));
      if (area > bestArea) {
        bestArea = area;
        best = p;
      }
    }

    const tl = best.topLeft as [number, number];
    const br = best.bottomRight as [number, number];
    const centerX = (tl[0] + br[0]) / 2;
    return centerX / decoded.width;
  } finally {
    tensor.dispose();
  }
}

function fillAndSmooth(samples: Array<number | null>): number[] {
  // Carry the nearest known value into gaps (a face briefly turning away
  // shouldn't yank the crop back to center).
  const filled = [...samples];
  for (let i = 0; i < filled.length; i++) {
    if (filled[i] === null) {
      const prev = [...filled.slice(0, i)].reverse().find((v) => v !== null);
      const next = filled.slice(i + 1).find((v) => v !== null);
      filled[i] = prev ?? next ?? 0.5;
    }
  }

  const values = filled as number[];
  const smoothed: number[] = [];
  const half = Math.floor(SMOOTHING_WINDOW / 2);
  for (let i = 0; i < values.length; i++) {
    const start = Math.max(0, i - half);
    const end = Math.min(values.length, i + half + 1);
    const window = values.slice(start, end);
    smoothed.push(window.reduce((a, b) => a + b, 0) / window.length);
  }
  return smoothed;
}

/** Analyzes a clip's source video for the dominant on-camera face and returns a
 * smoothed horizontal pan path, or null if no face was found anywhere in the
 * clip (caller should fall back to a plain center crop). */
export async function analyzeSubjectPan(sourcePath: string, startSec: number, endSec: number): Promise<PanKeyframe[] | null> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipforge-panscan-"));

  try {
    const frames = await extractSampleFrames(sourcePath, startSec, endSec, tempDir);
    if (frames.length === 0) return null;

    const rawSamples: Array<number | null> = [];
    for (const frame of frames) {
      try {
        rawSamples.push(await detectFaceCenterX(frame));
      } catch (err) {
        console.error("[subject-tracking] frame detection failed:", err instanceof Error ? err.message : err);
        rawSamples.push(null);
      }
    }

    if (rawSamples.every((s) => s === null)) return null;

    const smoothed = fillAndSmooth(rawSamples);
    return smoothed.map((xFrac, i) => ({
      t: i * SAMPLE_INTERVAL_SEC,
      xPercent: Math.max(0, Math.min(100, xFrac * 100)),
    }));
  } catch (err) {
    console.error("[subject-tracking] analysis failed, falling back to center crop:", err instanceof Error ? err.message : err);
    return null;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}
