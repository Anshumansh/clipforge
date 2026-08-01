import { ImageResponse } from "next/og";

export const runtime = "edge";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #0a0a0f 0%, #1a1025 50%, #0a0a0f 100%)",
          fontFamily: "Arial, Helvetica, sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            marginBottom: 28,
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 16,
              background: "linear-gradient(135deg, #7c3aed, #ec4899)",
              display: "flex",
            }}
          />
          <div style={{ fontSize: 44, fontWeight: 700, color: "white" }}>Clipforge</div>
        </div>
        <div
          style={{
            fontSize: 56,
            fontWeight: 800,
            color: "white",
            textAlign: "center",
            maxWidth: 900,
            lineHeight: 1.15,
          }}
        >
          Turn any idea into a scroll-stopping short video
        </div>
        <div style={{ fontSize: 26, color: "#a1a1aa", marginTop: 28 }}>
          AI script · voiceover · captions · b-roll, all in one render
        </div>
      </div>
    ),
    { ...size }
  );
}
