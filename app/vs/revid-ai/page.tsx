import type { Metadata } from "next";
import { ComparisonLandingPage, type ComparisonConfig } from "@/components/comparison-landing";

export const metadata: Metadata = {
  title: "Clipforge vs Revid.ai",
  description: "How Clipforge compares to Revid.ai on pricing, Trend Radar breakout detection, and a genuine free plan.",
};

const config: ComparisonConfig = {
  competitorName: "Revid.ai",
  badge: "Clipforge vs Revid.ai",
  headline: "Same idea — a real free plan and a cheaper way in.",
  subhead: "Revid.ai's published pricing starts at $39/mo with no free tier. Clipforge starts at $0, no card required, and its cheapest paid plan is half that.",
  rows: [
    {
      feature: "Free plan",
      us: "Yes — 50 credits/month, no card required",
      them: "Not listed — plans start at $39/mo",
      winner: "us",
    },
    {
      feature: "Entry-level pricing",
      us: "$0 free, then $19.99/mo Hobby (300 credits, ~30 videos)",
      them: "$39/mo Growth — 2,000 AI credits/month",
      winner: "us",
    },
    {
      feature: "Voice cloning from your own sample",
      us: "Included starting at $44.99/mo (Business)",
      them: "Included starting at $199/mo (Ultra)",
      winner: "us",
    },
    {
      feature: "Voiceover language coverage",
      us: "21 languages with real per-language neural voices",
      them: "70+ languages (Growth plan)",
      winner: "them",
    },
    {
      feature: "API / programmatic access",
      us: "REST API + a real MCP server (generate and check videos from Claude), on the Business plan ($44.99/mo)",
      them: "Included from the Growth plan ($39/mo)",
      winner: "neutral",
    },
    {
      feature: "UGC-style ad generation",
      us: "Voiceover-led ad videos with matched b-roll, no avatar, on the Business plan",
      them: "Yes — AI avatars and face swaps (Growth plan)",
      winner: "them",
    },
    {
      feature: "Track chosen channels for breakout content ideas",
      us: "Yes — Trend Radar scores breakouts against each tracked channel's own baseline",
      them: "Not listed among published features",
      winner: "us",
    },
  ],
  fairnessNote: "Feature and pricing details for Revid.ai reflect its public pricing page as of August 2026 — check revid.ai for current numbers before switching.",
  advantage: {
    title: "A free plan you can actually finish a video on",
    body: "50 free credits is enough for roughly five real, full-pipeline videos — script, voiceover, captions, and b-roll — before you're asked for a card. It's meant to answer \"does this actually work for my idea\" before you commit to a subscription.",
  },
  ctaHeadline: "Try it before you subscribe to anything",
  ctaBody: "50 free credits, no card required — enough to test a real idea end to end.",
};

export default function RevidComparisonPage() {
  return <ComparisonLandingPage config={config} />;
}
