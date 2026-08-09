export interface ChangelogEntry {
  date: string; // YYYY-MM-DD
  tag: "New" | "Improved" | "Fixed";
  title: string;
  description: string;
}

// Newest first. Every entry here is something that actually shipped --
// this is a changelog, not a roadmap (see lib/roadmap or /roadmap for
// what's still coming).
export const changelog: ChangelogEntry[] = [
  {
    date: "2026-08-10",
    tag: "New",
    title: "MCP server — generate videos from Claude",
    description:
      "Connect Clipforge to Claude Desktop or Claude Code with an API key and generate, check, and list videos without leaving your chat. Included on the Business plan.",
  },
  {
    date: "2026-08-10",
    tag: "New",
    title: "Brand kits",
    description:
      "Set a logo, colors, and font once and every script-to-video, repurpose, and UGC render picks it up automatically. Included on the Business plan.",
  },
  {
    date: "2026-08-09",
    tag: "New",
    title: "Try a real generation before you sign up",
    description:
      "Paste a topic in the homepage hero and get a real, watermarked video back — no account needed. Rate-limited, runs on the same pipeline as the full product.",
  },
  {
    date: "2026-08-08",
    tag: "New",
    title: "Trend Radar",
    description:
      "Tracks breakout videos in your niche via the official YouTube Data API and turns the structural pattern — hook type, pacing, not the content itself — into an original script idea.",
  },
  {
    date: "2026-08-08",
    tag: "New",
    title: "Self-hosted voice cloning",
    description:
      "Upload a short sample and narrate every generated video in your own voice, included on the Business plan at no extra per-word cost.",
  },
  {
    date: "2026-08-07",
    tag: "Improved",
    title: "Homepage rebuilt for real output",
    description:
      "Every clip and stat on the homepage is now pulled from real generations — no stock footage, no invented numbers.",
  },
  {
    date: "2026-08-05",
    tag: "New",
    title: "Direct publishing to TikTok, Reels, and Shorts",
    description: "Connect an account once and publish a finished render straight from the editor.",
  },
  {
    date: "2026-08-04",
    tag: "New",
    title: "Smart subject tracking for Repurpose",
    description: "Vertical crops now follow whoever's speaking automatically, using on-device face detection.",
  },
  {
    date: "2026-08-03",
    tag: "New",
    title: "Multi-format export",
    description: "Export the same render in 9:16, 1:1, and 16:9 without regenerating from scratch.",
  },
  {
    date: "2026-08-02",
    tag: "New",
    title: "Hook-score ranking",
    description: "Every generated clip gets scored on hook strength so you know which one to post first.",
  },
];
