import type { Metadata } from "next";
import { VerticalLandingPage, type VerticalConfig } from "@/components/vertical-landing";
import { UserRound, Sparkles, Wand2, Lightbulb, Image as ImageIcon, Grid3x3 } from "lucide-react";

export const metadata: Metadata = {
  title: "Clipforge for E-commerce & UGC Advertisers",
  description: "Generate talking-avatar UGC ad creative — new hooks and angles on demand, no actors, no camera, no reshoot.",
};

const config: VerticalConfig = {
  badge: "For e-commerce & UGC advertisers",
  headline: "UGC ad creative without the UGC creators",
  subhead: "Describe your product once. Get a finished talking-avatar ad with voiceover — then generate three more hook variants before your coffee's cold.",
  painPoint: {
    title: "Performance creative dies fast. Production can't keep up.",
    body: "A winning ad angle burns out in days, and booking a creator or reshooting for every new hook doesn't scale with how often you actually need fresh creative.",
  },
  features: [
    {
      icon: UserRound,
      title: "Talking-avatar ads, no camera required",
      body: "Turn a product description and selling points into a finished ad script with voiceover and avatar visuals — no actor, no studio, no shoot day.",
    },
    {
      icon: Lightbulb,
      title: "Hook variants on demand",
      body: "Generate multiple opening-hook options for the same product and pick the strongest one before you ever render a full ad.",
    },
    {
      icon: Grid3x3,
      title: "Export every placement size at once",
      body: "9:16, 1:1, and 16:9 from the same generation — no separate render per ad format on the Business plan.",
    },
    {
      icon: ImageIcon,
      title: "One-click thumbnail for every render",
      body: "Generate a matching thumbnail image straight from the finished video's title — useful for any placement that needs a static preview.",
    },
    {
      icon: Sparkles,
      title: "AI Idea Radar",
      body: "Short on angles? Idea Radar suggests fresh concepts to test instead of staring at a blank prompt.",
    },
    {
      icon: Wand2,
      title: "One credit pool, three engines",
      body: "The same account also does script-to-video for organic content and repurposing for testimonial/webinar footage — not a separate tool per format.",
    },
  ],
  ctaHeadline: "Generate your first ad variant free",
  ctaBody: "50 free credits, no card required — enough to test a real product angle before you commit to a plan.",
};

export default function EcommercePage() {
  return <VerticalLandingPage config={config} />;
}
