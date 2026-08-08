import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Reveal, RevealGroup, RevealItem } from "@/components/reveal";
import { PhoneMockup } from "@/components/phone-showcase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Captions,
  Clapperboard,
  Coins,
  Mic2,
  Scissors,
  Share2,
  Sparkles,
  Target,
  UserRound,
  Wand2,
  Zap,
} from "lucide-react";

const features = [
  {
    icon: Wand2,
    title: "Script or URL → video",
    description:
      "Paste a script, a blog post, or a link. Clipforge writes the hook, picks the pacing, and assembles a ready-to-post short.",
    big: true,
  },
  {
    icon: Scissors,
    title: "Repurpose long-form",
    description:
      "Upload a podcast or YouTube video. We find the highlight moments and cut them into vertical clips automatically, with the camera panned to follow whoever's talking.",
  },
  {
    icon: UserRound,
    title: "UGC & avatar ads",
    description: "Turn a product description into a talking-avatar ad script with voiceover — no camera, no actor.",
  },
  {
    icon: Mic2,
    title: "Clone your own voice",
    description: "Upload a short sample and narrate every video in your own voice instead of a stock one.",
  },
  {
    icon: Target,
    title: "Hook-score ranking",
    description: "Every clip gets scored on hook strength so you know which one to post first.",
  },
  {
    icon: Share2,
    title: "Auto-post everywhere",
    description: "Push a finished video straight to TikTok, Instagram Reels, or YouTube Shorts — no re-uploading.",
  },
  {
    icon: Captions,
    title: "Auto captions",
    description: "Word-by-word animated captions synced to the voiceover.",
  },
  {
    icon: Clapperboard,
    title: "Smart b-roll",
    description: "Relevant footage matched automatically to what your script is saying.",
  },
];

const steps = [
  { step: "01", title: "Pick a format", description: "Script-to-video, repurpose a long upload, or a UGC-style ad." },
  { step: "02", title: "Let AI assemble it", description: "Script, voiceover, captions, and b-roll come together in one render." },
  { step: "03", title: "Export & post", description: "Download — or auto-post straight to TikTok, Reels, and Shorts." },
];

// Real, unedited renders pulled straight from production — not stock footage or
// staged mockups. Muted/looped in the phone frames below.
const showcaseClips = [
  {
    src: "https://forgecut.app/api/media/media/cmsfwpkun00005ln9ty9j1vqs/cmsfwtaxc00025ln9310wv1dx/final.mp4",
    label: "Script to video",
  },
  {
    src: "https://forgecut.app/api/media/media/cmsfwpkun00005ln9ty9j1vqs/cmsjh8bs800017l6bezmf7umb/clip-cmsjh8rxw00057l6bn2le0p6g.mp4",
    label: "Repurpose — auto face tracking",
  },
  {
    src: "https://forgecut.app/api/media/media/cmsfwpkun00005ln9ty9j1vqs/cmsfwtuq000065ln9yuuato5u/final.mp4",
    label: "UGC / avatar ad",
  },
];

const differentiators = [
  {
    title: "Three engines, one credit pool",
    description: "Script-to-video, long-form repurposing, and UGC ad generation — most tools force you to pick one.",
  },
  {
    title: "Voice cloning included",
    description: "Narrate in your own voice at no extra per-word cost, on every paid plan tier that supports it.",
  },
  {
    title: "Publishing built in",
    description: "Connect TikTok, Instagram, and YouTube once — publish from inside the editor, not a separate tool.",
  },
  {
    title: "Built for a daily pipeline",
    description: "Bounded render concurrency keeps renders fast and reliable even when everyone posts at once.",
  },
];

const structuredData = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Clipforge",
  applicationCategory: "MultimediaApplication",
  operatingSystem: "Web",
  description:
    "AI short-form video generator — turns a script, URL, or long-form upload into a captioned, voiced, edited vertical video for TikTok, Reels, and Shorts.",
  offers: {
    "@type": "AggregateOffer",
    lowPrice: "0",
    highPrice: "99",
    priceCurrency: "USD",
    offerCount: "3",
  },
};

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <SiteHeader />
      <main className="flex-1">
        <section className="hero-glow grid-pattern relative overflow-hidden px-6 pb-24 pt-24">
          <div className="mx-auto grid max-w-6xl items-center gap-16 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="text-center lg:text-left">
              <Reveal>
                <Badge variant="outline" className="mx-auto mb-6 w-fit gap-1.5 border-primary/30 bg-primary/5 lg:mx-0">
                  <Sparkles className="h-3 w-3 text-primary" /> AI short-form video, end to end
                </Badge>
              </Reveal>
              <Reveal delay={0.05}>
                <h1 className="mx-auto max-w-xl text-4xl font-bold tracking-tight sm:text-6xl lg:mx-0">
                  Turn any idea into a{" "}
                  <span className="gradient-text">scroll-stopping</span> short video
                </h1>
              </Reveal>
              <Reveal delay={0.1}>
                <p className="mx-auto mt-6 max-w-xl text-lg text-muted-foreground lg:mx-0">
                  Clipforge writes the script, generates the voiceover, cuts the b-roll, captions it, and can post it
                  straight to TikTok, Reels, and Shorts — so you never touch an editor.
                </p>
              </Reveal>
              <Reveal delay={0.15}>
                <div className="mt-10 flex items-center justify-center gap-4 lg:justify-start">
                  <Button asChild size="lg">
                    <Link href="/register">Start creating — free</Link>
                  </Button>
                  <Button asChild size="lg" variant="outline">
                    <Link href="/pricing">See pricing</Link>
                  </Button>
                </div>
                <p className="mt-4 text-xs text-muted-foreground">No credit card required · 50 free credits</p>
              </Reveal>

              <Reveal delay={0.22}>
                <div className="mx-auto mt-16 grid max-w-md grid-cols-2 gap-4 sm:grid-cols-4 lg:mx-0">
                  {[
                    { icon: Wand2, label: "3 generation engines" },
                    { icon: Mic2, label: "Free voice cloning" },
                    { icon: Share2, label: "Direct social publishing" },
                    { icon: Coins, label: "One credit-based plan" },
                  ].map((s) => (
                    <div
                      key={s.label}
                      className="flex flex-col items-center gap-2 rounded-xl border border-border/60 bg-card/40 px-3 py-4 text-center text-xs text-muted-foreground lg:items-start lg:text-left"
                    >
                      <s.icon className="h-4 w-4 text-primary" />
                      {s.label}
                    </div>
                  ))}
                </div>
              </Reveal>
            </div>

            <Reveal delay={0.2} className="mx-auto w-full max-w-[280px] lg:mx-0">
              <PhoneMockup src={showcaseClips[1].src} label="Real, unedited Clipforge output" lazy={false} />
            </Reveal>
          </div>
        </section>

        <section className="border-y border-border/60 bg-secondary/30 px-6 py-20">
          <Reveal>
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-bold tracking-tight">Real output, not mockups</h2>
              <p className="mt-4 text-muted-foreground">
                Every clip below was generated end to end by Clipforge — nothing staged, nothing hand-edited.
              </p>
            </div>
          </Reveal>
          <RevealGroup className="mx-auto mt-14 grid max-w-4xl grid-cols-1 gap-10 sm:grid-cols-3">
            {showcaseClips.map((clip) => (
              <RevealItem key={clip.src} className="mx-auto w-full max-w-[220px]">
                <PhoneMockup src={clip.src} label={clip.label} float={false} />
              </RevealItem>
            ))}
          </RevealGroup>
        </section>

        <section id="features" className="mx-auto max-w-6xl px-6 py-20">
          <Reveal>
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-bold tracking-tight">Everything you need to ship shorts daily</h2>
              <p className="mt-4 text-muted-foreground">
                One credit-based workspace instead of five separate tools.
              </p>
            </div>
          </Reveal>
          <RevealGroup className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {features.map((f) => (
              <RevealItem key={f.title} className={f.big ? "sm:col-span-2" : undefined}>
                <div className="glow-ring group h-full">
                  <Card className="h-full border-transparent bg-card/80 transition-transform duration-300 group-hover:-translate-y-1">
                    <CardHeader>
                      <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-primary/20 to-accent/20">
                        <f.icon className="h-5 w-5 text-primary" />
                      </div>
                      <CardTitle className="text-base">{f.title}</CardTitle>
                      <CardDescription>{f.description}</CardDescription>
                    </CardHeader>
                  </Card>
                </div>
              </RevealItem>
            ))}
          </RevealGroup>
        </section>

        <section id="how-it-works" className="border-y border-border/60 bg-secondary/30 px-6 py-20">
          <div className="mx-auto max-w-6xl">
            <Reveal>
              <h2 className="text-center text-3xl font-bold tracking-tight">How it works</h2>
            </Reveal>
            <RevealGroup className="relative mt-16 grid gap-10 md:grid-cols-3">
              <div
                aria-hidden="true"
                className="absolute left-0 right-0 top-6 hidden h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent md:block"
              />
              {steps.map((s) => (
                <RevealItem key={s.step} className="relative text-center">
                  <div className="relative z-10 mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-primary/40 bg-background font-display font-semibold text-primary">
                    {s.step}
                  </div>
                  <h3 className="text-lg font-semibold">{s.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">{s.description}</p>
                </RevealItem>
              ))}
            </RevealGroup>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 py-20">
          <Reveal>
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-bold tracking-tight">Why creators switch to Clipforge</h2>
            </div>
          </Reveal>
          <RevealGroup className="mt-14 grid gap-6 sm:grid-cols-2">
            {differentiators.map((d) => (
              <RevealItem key={d.title}>
                <div className="flex gap-4 rounded-xl border border-border/60 bg-card/40 p-6">
                  <Zap className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                  <div>
                    <h3 className="font-semibold">{d.title}</h3>
                    <p className="mt-1.5 text-sm text-muted-foreground">{d.description}</p>
                  </div>
                </div>
              </RevealItem>
            ))}
          </RevealGroup>
        </section>

        <section className="px-6 py-24">
          <Reveal>
            <div className="glow-ring mx-auto max-w-4xl">
              <div className="hero-glow rounded-2xl border border-transparent bg-card/60 px-6 py-16 text-center">
                <Zap className="mx-auto mb-4 h-8 w-8 text-primary" />
                <h2 className="text-3xl font-bold tracking-tight">
                  Stop paying an editor for content you can generate
                </h2>
                <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
                  Join creators and brands using Clipforge to keep a daily short-form pipeline running on autopilot.
                </p>
                <Button asChild size="lg" className="mt-8">
                  <Link href="/register">Create your first video</Link>
                </Button>
              </div>
            </div>
          </Reveal>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
