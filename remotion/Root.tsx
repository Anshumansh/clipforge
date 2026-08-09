import React from "react";
import { Composition } from "remotion";
import { ScriptVideo, type ScriptVideoProps } from "./ScriptVideo";
import { RepurposeClip, type RepurposeClipProps } from "./RepurposeClip";
import { AudioExtract, type AudioExtractProps } from "./AudioExtract";
import { Thumbnail, type ThumbnailProps } from "./Thumbnail";
import { ASPECT_RATIO_DIMENSIONS } from "../lib/aspect-ratio";

const FPS = 30;

const scriptDefaultProps: ScriptVideoProps = {
  words: [{ word: "Loading…", start: 0, end: 2 }],
  scenes: [{ type: "gradient", from: "#7c3aed", to: "#ec4899", label: "loading" }],
  audioUrl: null,
  durationInSeconds: 3,
};

const repurposeDefaultProps: RepurposeClipProps = {
  sourcePath: "",
  startSec: 0,
  endSec: 3,
  title: "Highlight",
};

const audioExtractDefaultProps: AudioExtractProps = {
  sourcePath: "",
  durationInSeconds: 3,
};

const thumbnailDefaultProps: ThumbnailProps = {
  imageUrl: "",
  title: "Loading…",
};

// Remotion's <Composition> generics require a zod `schema` to infer prop types cleanly.
// We pass plain TS interfaces instead, so we widen to Record<string, unknown> at this
// registration boundary only — the actual components stay strongly typed everywhere else.
const AnyComposition = Composition as unknown as React.FC<{
  id: string;
  component: React.FC<Record<string, unknown>>;
  durationInFrames: number;
  fps: number;
  width: number;
  height: number;
  defaultProps: Record<string, unknown>;
  calculateMetadata: (options: {
    props: Record<string, unknown>;
  }) => Promise<{ durationInFrames: number; width?: number; height?: number }>;
}>;

export function Root() {
  return (
    <>
      <AnyComposition
        id="ScriptVideo"
        component={ScriptVideo as unknown as React.FC<Record<string, unknown>>}
        durationInFrames={Math.ceil(scriptDefaultProps.durationInSeconds * FPS)}
        fps={FPS}
        width={1080}
        height={1920}
        defaultProps={scriptDefaultProps as unknown as Record<string, unknown>}
        calculateMetadata={async ({ props }) => {
          const p = props as unknown as ScriptVideoProps;
          const dims = ASPECT_RATIO_DIMENSIONS[p.aspectRatio ?? "9:16"];
          return { durationInFrames: Math.max(Math.ceil(p.durationInSeconds * FPS), FPS), ...dims };
        }}
      />
      <AnyComposition
        id="RepurposeClip"
        component={RepurposeClip as unknown as React.FC<Record<string, unknown>>}
        durationInFrames={Math.ceil((repurposeDefaultProps.endSec - repurposeDefaultProps.startSec) * FPS)}
        fps={FPS}
        width={1080}
        height={1920}
        defaultProps={repurposeDefaultProps as unknown as Record<string, unknown>}
        calculateMetadata={async ({ props }) => {
          const p = props as unknown as RepurposeClipProps;
          const dims = ASPECT_RATIO_DIMENSIONS[p.aspectRatio ?? "9:16"];
          return { durationInFrames: Math.max(Math.ceil((p.endSec - p.startSec) * FPS), FPS), ...dims };
        }}
      />
      <AnyComposition
        id="AudioExtract"
        component={AudioExtract as unknown as React.FC<Record<string, unknown>>}
        durationInFrames={Math.ceil(audioExtractDefaultProps.durationInSeconds * FPS)}
        fps={FPS}
        width={2}
        height={2}
        defaultProps={audioExtractDefaultProps as unknown as Record<string, unknown>}
        calculateMetadata={async ({ props }) => {
          const p = props as unknown as AudioExtractProps;
          return { durationInFrames: Math.max(Math.ceil(p.durationInSeconds * FPS), FPS) };
        }}
      />
      <AnyComposition
        id="Thumbnail"
        component={Thumbnail as unknown as React.FC<Record<string, unknown>>}
        durationInFrames={1}
        fps={FPS}
        width={1280}
        height={720}
        defaultProps={thumbnailDefaultProps as unknown as Record<string, unknown>}
        calculateMetadata={async () => ({ durationInFrames: 1 })}
      />
    </>
  );
}
