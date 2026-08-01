import React from "react";
import { AbsoluteFill, OffthreadVideo, useVideoConfig } from "remotion";
import { resolveSource } from "./resolve-source";

export interface RepurposeClipProps {
  sourcePath: string; // absolute URL (remote storage) or path relative to /public (local dev)
  startSec: number;
  endSec: number;
  title: string;
}

export function RepurposeClip({ sourcePath, startSec, endSec, title }: RepurposeClipProps) {
  const { fps } = useVideoConfig();

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
            objectPosition: "center",
          }}
        />
      </AbsoluteFill>
      <AbsoluteFill style={{ background: "linear-gradient(to top, rgba(0,0,0,0.6), transparent 30%)" }} />
      <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 140 }}>
        <div
          style={{
            fontFamily: "Arial, Helvetica, sans-serif",
            fontWeight: 800,
            fontSize: 52,
            color: "#fff",
            textAlign: "center",
            maxWidth: 880,
            textShadow: "0 4px 18px rgba(0,0,0,0.65)",
            padding: "0 40px",
          }}
        >
          {title}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
