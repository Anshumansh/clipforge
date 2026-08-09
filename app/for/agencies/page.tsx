import type { Metadata } from "next";
import Link from "next/link";
import { VerticalLandingPage, type VerticalConfig } from "@/components/vertical-landing";
import { Layers, Grid3x3, Mic2, ImageIcon, Zap, Calendar } from "lucide-react";

export const metadata: Metadata = {
  title: "Clipforge for Agencies",
  description: "Run script-to-video, repurposing, and UGC ad production for every client from one credit pool and one dashboard.",
};

const config: VerticalConfig = {
  badge: "For agencies",
  headline: "One dashboard for every client's short-form production",
  subhead: "Script-to-video, long-form repurposing, and UGC ad generation share one credit pool — switching between a client's podcast clips and another client's ad creative doesn't mean switching tools.",
  painPoint: {
    title: "Client work means constantly switching formats, not just switching clients",
    body: "One client needs podcast highlight clips, the next needs UGC-style ad creative, the next needs a script-to-video explainer — most stacks mean a different tool (and a different bill) for each.",
  },
  features: [
    {
      icon: Layers,
      title: "Three engines, one account",
      body: "Script-to-video, Repurpose, and UGC ads all draw from the same credit pool — reallocate spend across client work without juggling separate subscriptions.",
    },
    {
      icon: Grid3x3,
      title: "Every export size from one render",
      body: "9:16, 1:1, and 16:9 from the same generation on the Business plan — match whatever placement each client's campaign actually needs.",
    },
    {
      icon: Mic2,
      title: "Client voice cloning, included",
      body: "Narrate in a client's own voice from a short reference sample, at no extra per-word cost on Business — not billed separately per character like most cloning tools.",
    },
    {
      icon: ImageIcon,
      title: "4K export + thumbnails",
      body: "Full 4K output plus a one-click matching thumbnail for every finished render, generated from the video's own title.",
    },
    {
      icon: Calendar,
      title: "Calendar-based scheduling",
      body: "Batch-schedule a connected account's posts across the week instead of publishing one at a time.",
    },
    {
      icon: Zap,
      title: "Built for daily-pipeline load",
      body: "A bounded-concurrency render queue keeps output fast and stable even when a full day of client renders queues up at once.",
    },
  ],
  ctaHeadline: "See it handle a real client brief",
  ctaBody: "50 free credits to start. Multi-seat team accounts are on the roadmap, not live yet — track progress on the roadmap board.",
};

// The CTA copy links transparently to the roadmap rather than implying
// multi-user support exists today -- SocialAccount is unique per
// (userId, platform), one connected account per platform per Clipforge
// account, not a multi-client account manager yet (item 12, unshipped).
export default function AgenciesPage() {
  return <VerticalLandingPage config={config} />;
}
