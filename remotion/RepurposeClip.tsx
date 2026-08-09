import React from "react";
import { AbsoluteFill, Img, OffthreadVideo, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { resolveSource } from "./resolve-source";
import type { AspectRatio } from "@/lib/aspect-ratio";
import { resolveFontFamily, type BrandSettings } from "@/lib/brand";

// Kept as a plain local type (not imported from lib/providers/subject-tracking)
// so this file never pulls that module's TensorFlow.js dependency graph into
// Remotion's own bundler — analysis runs ahead of time in the job runner, this
// component only ever sees the small resulting keyframe list.
interface PanKeyframe {
  t: number;
  xPercent: number;
}

export interface RepurposeClipProps {
  sourcePath: string; // absolute URL (remote storage) or path relative to /public (local dev)
  startSec: number;
  endSec: number;
  title: string;
  /** Resolved to actual pixel dimensions in Root.tsx's calculateMetadata. */
  aspectRatio?: AspectRatio;
  /** Smoothed horizontal face-pan path from lib/providers/subject-tracking.ts,
   * one sample per second. Falls back to a static center crop when absent
   * (analysis found no face, or the source video is being repurposed without it). */
  panKeyframes?: PanKeyframe[];
  /** Business-plan brand kit -- see remotion/ScriptVideo.tsx for the full
   * explanation. Undefined for everyone else. */
  brand?: BrandSettings;
}

function usePanObjectPosition(panKeyframes: PanKeyframe[] | undefined) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (!panKeyframes || panKeyframes.length === 0) return "center";
  // interpolate() requires at least 2 points in the range.
  if (panKeyframes.length === 1) return `${panKeyframes[0].xPercent}% center`;

  const t = frame / fps;
  const xPercent = interpolate(
    t,
    panKeyframes.map((k) => k.t),
    panKeyframes.map((k) => k.xPercent),
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  return `${xPercent}% center`;
}

export function RepurposeClip({ sourcePath, startSec, endSec, title, panKeyframes, brand }: RepurposeClipProps) {
  const { fps, width, height } = useVideoConfig();
  const objectPosition = usePanObjectPosition(panKeyframes);
  const fontFamily = resolveFontFamily(brand?.fontFamily);

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <AbsoluteFill style={{ overflow: "hidden" }}>
        <OffthreadVideo
          src={resolveSource(sourcePath)}
          trimBefore={Math.round(startSec * fps)}
          trimAfter={Math.round(endSec * fps)}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            objectPosition,
          }}
        />
      </AbsoluteFill>
      <AbsoluteFill style={{ background: "linear-gradient(to top, rgba(0,0,0,0.6), transparent 30%)" }} />
      <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: width * 0.1296 }}>
        <div
          style={{
            fontFamily,
            fontWeight: 800,
            fontSize: width * 0.0481,
            color: "#fff",
            textAlign: "center",
            maxWidth: width * 0.8148,
            textShadow: "0 4px 18px rgba(0,0,0,0.65)",
            padding: `0 ${width * 0.037}px`,
          }}
        >
          {title}
        </div>
      </AbsoluteFill>
      {brand?.logoUrl && (
        <Img
          src={brand.logoUrl}
          style={{
            position: "absolute",
            left: width * 0.03,
            top: height * 0.03,
            maxHeight: height * 0.06,
            maxWidth: width * 0.28,
            objectFit: "contain",
            filter: "drop-shadow(0 1px 4px rgba(0,0,0,0.6))",
          }}
        />
      )}
    </AbsoluteFill>
  );
}
