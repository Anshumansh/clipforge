import React from "react";
import { AbsoluteFill, Img, useVideoConfig } from "remotion";
import { resolveSource } from "./resolve-source";

export interface ThumbnailProps {
  imageUrl: string | null;
  title: string;
}

/** A single still frame at YouTube's standard 1280x720 thumbnail size --
 * background photo + a dark gradient for legibility + bold title text. Not
 * a generative-AI image (no free provider for that exists), a real
 * composite from real assets: a Pexels stock photo the same way b-roll
 * already works, plus the project's own title. */
export function Thumbnail({ imageUrl, title }: ThumbnailProps) {
  const { width, height } = useVideoConfig();

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {imageUrl ? (
        <Img src={resolveSource(imageUrl)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      ) : (
        <AbsoluteFill style={{ background: "linear-gradient(135deg, #7c3aed, #ec4899)" }} />
      )}
      <AbsoluteFill
        style={{
          background: "linear-gradient(0deg, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.15) 45%, rgba(0,0,0,0.35) 100%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: width * 0.05,
          right: width * 0.05,
          bottom: height * 0.08,
          fontFamily: "Arial, Helvetica, sans-serif",
          fontWeight: 900,
          fontSize: width * 0.075,
          lineHeight: 1.05,
          color: "#fff",
          textShadow: "0 2px 12px rgba(0,0,0,0.8), 0 0 2px rgba(0,0,0,0.9)",
          textTransform: "uppercase",
          letterSpacing: "-0.01em",
        }}
      >
        {title}
      </div>
    </AbsoluteFill>
  );
}
