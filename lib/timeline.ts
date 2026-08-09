import type { BrollScene } from "@/lib/providers/types";

export interface SceneTimelineEntry {
  index: number;
  label: string;
  type: BrollScene["type"];
  sourceUrl: string | null;
  startSec: number;
  endSec: number;
}

/** Mirrors the scene-cut math in remotion/ScriptVideo.tsx (framesPerScene =
 * totalFrames / sceneCount, sequential placement) but returns nominal cut
 * boundaries rather than the crossfade-widened Sequence ranges the renderer
 * uses internally -- an editor re-cutting in an NLE wants the cut point, not
 * the fade overlap either side of it. */
export function computeSceneTimeline(scenes: BrollScene[], durationInSeconds: number, fps = 30): SceneTimelineEntry[] {
  const totalFrames = Math.ceil(durationInSeconds * fps);
  const sceneCount = Math.max(scenes.length, 1);
  const framesPerScene = Math.ceil(totalFrames / sceneCount);

  return scenes.map((scene, i) => ({
    index: i,
    label: scene.label,
    type: scene.type,
    sourceUrl: scene.type === "gradient" ? null : scene.url,
    startSec: (i * framesPerScene) / fps,
    endSec: (Math.min((i + 1) * framesPerScene, totalFrames)) / fps,
  }));
}
