import React from "react";
import { AbsoluteFill, OffthreadVideo, staticFile } from "remotion";

export interface AudioExtractProps {
  sourcePath: string; // path relative to /public
  durationInSeconds: number;
}

// Renders just the audio track of a source video through Remotion's real encoding
// pipeline (not a raw remux) so the output is a standards-compliant file any
// transcription API can decode, regardless of the source's original audio codec.
export function AudioExtract({ sourcePath }: AudioExtractProps) {
  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <OffthreadVideo src={staticFile(sourcePath)} />
    </AbsoluteFill>
  );
}
