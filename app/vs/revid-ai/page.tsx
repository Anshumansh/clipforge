import type { Metadata } from "next";
import { ComparisonLandingPage, type ComparisonConfig } from "@/components/comparison-landing";

export const metadata: Metadata = {
  title: "Clipforge vs Revid.ai",
  description: "How Clipforge compares to Revid.ai on pricing, Trend Radar breakout detection, and a genuine free plan.",
};

const config: ComparisonConfig = {
  competitorName: "Revid.ai",
  badge: "Clipforge vs Revid.ai",
  headline: "Same goal — a lower-cost way to prove your workflow.",
  subhead: "Revid.ai's published memberships start at $39/month. Clipforge starts with 50 included credits and its Creator plan is $26.88/month.",
  rows: [
    {
      feature: "Free plan",
      us: "50 included signup credits, no card required",
      them: "No ongoing free membership listed; paid memberships start at $39/mo",
      winner: "us",
    },
    {
      feature: "Entry-level pricing",
      us: "$26.88/mo Creator (600 credits, about 60 standard videos)",
      them: "$39/mo Hobby; Growth is also advertised from $39/mo",
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
      us: "Voiceover-led ad videos with matched b-roll, no avatar, on Creator and Business",
      them: "Yes — AI avatars and face swaps (Growth plan)",
      winner: "them",
    },
    {
      feature: "Track chosen channels for breakout content ideas",
      us: "Yes — Trend Radar scores breakouts against each tracked channel's own baseline",
      them: "Growth lists monitoring 5 channels for viral ideas",
      winner: "neutral",
    },
  ],
  fairnessNote: "Revid.ai details were checked against its official pricing page on 25 August 2026. Prices and features can change; verify revid.ai/pricing before switching.",
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
