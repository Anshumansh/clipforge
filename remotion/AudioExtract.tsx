import React from "react";
import { AbsoluteFill, OffthreadVideo } from "remotion";
import { resolveSource } from "./resolve-source";

export interface AudioExtractProps {
  sourcePath: string; // absolute URL (remote storage) or path relative to /public (local dev)
  durationInSeconds: number;
}

// Renders just the audio track of a source video through Remotion's real encoding
// pipeline (not a raw remux) so the output is a standards-compliant file any
// transcription API can decode, regardless of the source's original audio codec.
export function AudioExtract({ sourcePath }: AudioExtractProps) {
  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <OffthreadVideo src={resolveSource(sourcePath)} />
    </AbsoluteFill>
  );
}
