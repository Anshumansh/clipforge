import React from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { resolveSource } from "./resolve-source";
import type { BrollScene, WordTiming } from "@/lib/providers/types";
import type { AspectRatio } from "@/lib/aspect-ratio";

export interface ScriptVideoProps {
  words: WordTiming[];
  scenes: BrollScene[];
  audioUrl: string | null;
  durationInSeconds: number;
  ctaText?: string;
  /** Resolved to actual pixel dimensions in Root.tsx's calculateMetadata — this
   * component reads the resulting size via useVideoConfig() rather than the raw
   * ratio, so every aspect ratio shares one proportionally-scaled layout. */
  aspectRatio?: AspectRatio;
}

function useCrossfadeOpacity(durationInFrames: number, fadeInFrames: number, fadeOutFrames: number) {
  const frame = useCurrentFrame();
  const input = [0];
  const output = [fadeInFrames > 0 ? 0 : 1];
  if (fadeInFrames > 0) {
    input.push(fadeInFrames);
    output.push(1);
  }
  if (fadeOutFrames > 0) {
    input.push(durationInFrames - fadeOutFrames);
    output.push(1);
  }
  input.push(durationInFrames);
  output.push(fadeOutFrames > 0 ? 0 : 1);
  return interpolate(frame, input, output, { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
}

function BrollBackground({
  scene,
  durationInFrames,
  fadeInFrames,
  fadeOutFrames,
}: {
  scene: BrollScene;
  durationInFrames: number;
  fadeInFrames: number;
  fadeOutFrames: number;
}) {
  const frame = useCurrentFrame();
  const scale = interpolate(frame, [0, durationInFrames], [1, 1.12], { extrapolateRight: "clamp" });
  const opacity = useCrossfadeOpacity(durationInFrames, fadeInFrames, fadeOutFrames);

  if (scene.type === "video") {
    return (
      <AbsoluteFill style={{ overflow: "hidden", backgroundColor: "#111", opacity }}>
        <OffthreadVideo
          src={scene.url}
          muted
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform: `scale(${scale})`,
          }}
        />
        <AbsoluteFill style={{ background: "linear-gradient(to top, rgba(0,0,0,0.55), rgba(0,0,0,0.05) 40%)" }} />
      </AbsoluteFill>
    );
  }

  if (scene.type === "image") {
    return (
      <AbsoluteFill style={{ overflow: "hidden", backgroundColor: "#111", opacity }}>
        <Img
          src={scene.url}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform: `scale(${scale})`,
          }}
        />
        <AbsoluteFill style={{ background: "linear-gradient(to top, rgba(0,0,0,0.55), rgba(0,0,0,0.05) 40%)" }} />
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(135deg, ${scene.from}, ${scene.to})`,
        transform: `scale(${scale})`,
        opacity,
      }}
    >
      <AbsoluteFill style={{ background: "radial-gradient(circle at 50% 30%, rgba(255,255,255,0.18), transparent 60%)" }} />
    </AbsoluteFill>
  );
}

// Every measurement below is proportional to the 1080x1920 frame these values were
// originally tuned for, so the same visual composition holds at 1:1 and 16:9 too.
function Captions({ words }: { words: WordTiming[] }) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;

  const activeIndex = words.findIndex((w) => t >= w.start && t < w.end);
  if (activeIndex === -1) return null;

  const windowSize = 3;
  const start = Math.max(0, activeIndex - 1);
  const visible = words.slice(start, start + windowSize + 1);

  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: height * 0.1146 }}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: `0 ${width * 0.013}px`,
          maxWidth: width * 0.8148,
          padding: `0 ${width * 0.037}px`,
        }}
      >
        {visible.map((w, i) => {
          const globalIndex = start + i;
          const isActive = globalIndex === activeIndex;
          return (
            <span
              key={globalIndex}
              style={{
                fontFamily: "Arial, Helvetica, sans-serif",
                fontWeight: 800,
                fontSize: width * 0.0593,
                lineHeight: 1.2,
                color: isActive ? "#FFD400" : "#FFFFFF",
                textShadow: "0 4px 18px rgba(0,0,0,0.65)",
                transform: isActive ? "scale(1.08)" : "scale(1)",
              }}
            >
              {w.word}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}

function CtaCard({ text }: { text: string }) {
  const { width } = useVideoConfig();
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", backgroundColor: "rgba(0,0,0,0.55)" }}>
      <div
        style={{
          fontFamily: "Arial, Helvetica, sans-serif",
          fontWeight: 900,
          fontSize: width * 0.0667,
          color: "#fff",
          textAlign: "center",
          maxWidth: width * 0.7407,
          padding: `${width * 0.0296}px ${width * 0.0444}px`,
          borderRadius: width * 0.0222,
          background: "linear-gradient(135deg, #7c3aed, #ec4899)",
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
}

export function ScriptVideo({ words, scenes, audioUrl, durationInSeconds, ctaText }: ScriptVideoProps) {
  const { fps } = useVideoConfig();
  const totalFrames = Math.ceil(durationInSeconds * fps);
  const sceneCount = Math.max(scenes.length, 1);
  const framesPerScene = Math.ceil(totalFrames / sceneCount);
  const ctaDuration = Math.round(fps * 2);
  const overlap = Math.min(Math.round(fps * 0.35), Math.floor(framesPerScene / 3));

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {scenes.map((scene, i) => {
        const isFirst = i === 0;
        const isLast = i === scenes.length - 1;
        const fadeInFrames = isFirst ? 0 : overlap;
        const fadeOutFrames = isLast ? 0 : overlap;
        const from = i * framesPerScene - fadeInFrames;
        const durationInFrames = framesPerScene + fadeInFrames + fadeOutFrames;

        return (
          <Sequence key={i} from={from} durationInFrames={durationInFrames}>
            <BrollBackground
              scene={scene}
              durationInFrames={durationInFrames}
              fadeInFrames={fadeInFrames}
              fadeOutFrames={fadeOutFrames}
            />
          </Sequence>
        );
      })}
      <Captions words={words} />
      {ctaText && (
        <Sequence from={Math.max(totalFrames - ctaDuration, 0)} durationInFrames={ctaDuration}>
          <CtaCard text={ctaText} />
        </Sequence>
      )}
      {audioUrl && <Audio src={resolveSource(audioUrl)} />}
    </AbsoluteFill>
  );
}
