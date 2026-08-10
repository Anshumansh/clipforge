import type { Metadata } from "next";
import { VerticalLandingPage, type VerticalConfig } from "@/components/vertical-landing";
import { Scissors, Captions, Target, Share2, Calendar, UserRound } from "lucide-react";

export const metadata: Metadata = {
  title: "Clipforge for Podcasters",
  description: "Turn every episode into a week of clips — automatic highlight detection, speaker tracking, and captions, without cutting anything by hand.",
};

const config: VerticalConfig = {
  badge: "For podcasters",
  headline: "Your episode already has the clips in it. Stop cutting them out by hand.",
  subhead: "Upload an episode, get back a set of vertical highlight clips with captions and a hook score — ready to post, not a rough cut you still have to edit.",
  painPoint: {
    title: "The bottleneck was never the podcast — it was the clipping",
    body: "You record consistently, but turning a 45-minute conversation into 5-6 postable moments takes hours of scrubbing and manual cropping every single week. That's the part Clipforge actually replaces.",
  },
  features: [
    {
      icon: Scissors,
      title: "Automatic highlight detection",
      body: "Upload the full episode. Clipforge transcribes it and finds the moments worth cutting — you don't have to already know which ones are good.",
    },
    {
      icon: UserRound,
      title: "Camera that follows whoever's talking",
      body: "Vertical crops track the active speaker automatically using on-device face detection — no manual reframing per clip.",
    },
    {
      icon: Target,
      title: "Hook-score ranking",
      body: "Every clip gets scored on hook strength, so you know which one to post first instead of guessing.",
    },
    {
      icon: Captions,
      title: "Word-by-word captions",
      body: "Every clip is captioned automatically, synced to the actual audio.",
    },
    {
      icon: Share2,
      title: "Publish straight from the editor",
      body: "Connect your show's TikTok, Reels, or Shorts account from the dashboard — publishing goes live per platform as developer approval clears, so a finished clip skips the download-and-re-upload step once it does.",
    },
    {
      icon: Calendar,
      title: "Schedule a week of clips at once",
      body: "Batch-schedule your episode's clips across the week from one calendar view instead of posting them all the same day.",
    },
  ],
  ctaHeadline: "Upload your next episode and see the clips it finds",
  ctaBody: "50 free credits to start — enough to repurpose a real episode before you decide anything.",
};

export default function PodcastersPage() {
  return <VerticalLandingPage config={config} />;
}
