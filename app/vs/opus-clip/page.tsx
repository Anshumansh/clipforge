import type { Metadata } from "next";
import { ComparisonLandingPage, type ComparisonConfig } from "@/components/comparison-landing";

export const metadata: Metadata = {
  title: "Clipforge vs Opus Clip",
  description: "How Clipforge compares to Opus Clip — script-to-video and UGC ad generation alongside repurposing, not just repurposing alone.",
};

const config: ComparisonConfig = {
  competitorName: "Opus Clip",
  badge: "Clipforge vs Opus Clip",
  headline: "Opus Clip repurposes what you already recorded. Clipforge also makes something from nothing.",
  subhead: "Both cut long-form video into clips. Clipforge adds script-to-video from a bare idea and UGC-style ad generation in the same account, on the same credit pool.",
  rows: [
    {
      feature: "Generate a full video from just a topic or script",
      us: "Yes — script-to-video writes the script, sources matching b-roll, and renders it",
      them: "Not the focus — built around clipping footage you upload or import",
      winner: "us",
    },
    {
      feature: "Repurpose long-form video into clips",
      us: "Yes — highlight detection, speaker-tracking crop, hook-score ranking, captions",
      them: "Yes — Opus Clip's core feature, with virality scoring and custom reframing on Pro",
      winner: "neutral",
    },
    {
      feature: "UGC-style ad generation (voiceover-led, no avatar)",
      us: "Yes, included on Creator and Business",
      them: "Real-time trend analysis is listed on the custom Business tier",
      winner: "neutral",
    },
    {
      feature: "Track chosen channels for breakout content ideas",
      us: "Yes — Trend Radar scores breakouts against each tracked channel's own baseline",
      them: "Not listed as a feature",
      winner: "us",
    },
    {
      feature: "Voice cloning from your own sample",
      us: "Yes, on the Business plan",
      them: "AI voice-over available (20/day on Starter), no cloning listed",
      winner: "us",
    },
    {
      feature: "Entry-level paid plan",
      us: "$26.88/mo Creator — 600 credits, about 60 standard videos",
      them: "$15/mo Starter — 150 credits and watermark-free export",
      winner: "them",
    },
    {
      feature: "Free plan",
      us: "Yes — 50 included signup credits, no card required",
      them: "Yes — 60 monthly credits, watermarked exports, and 3-day export availability",
      winner: "neutral",
    },
  ],
  fairnessNote: "Opus Clip details were checked against its official pricing page on 25 August 2026. Prices and features can change; verify opus.pro/pricing before switching.",
  advantage: {
    title: "One credit pool, three engines",
    body: "Script-to-video, Repurpose, and UGC ads all draw from the same Clipforge account and the same credit balance. You're not paying for a separate tool, and a separate subscription, every time the format of what you need changes.",
  },
  ctaHeadline: "See the difference on a real idea",
  ctaBody: "50 included credits, no card required — enough to try Script-to-Video before you decide anything.",
};

export default function OpusClipComparisonPage() {
  return <ComparisonLandingPage config={config} />;
}
