import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Captions, Clapperboard, Mic2, Scissors, Sparkles, UserRound, Wand2, Zap } from "lucide-react";

const features = [
  {
    icon: Wand2,
    title: "Script or URL → video",
    description:
      "Paste a script, a blog post, or a link. Clipforge writes the hook, picks the pacing, and assembles a ready-to-post short.",
  },
  {
    icon: Scissors,
    title: "Repurpose long-form",
    description:
      "Upload a podcast or YouTube video. We find the highlight moments and cut them into vertical clips automatically.",
  },
  {
    icon: UserRound,
    title: "UGC & avatar ads",
    description:
      "Turn a product description into a talking-avatar ad script with voiceover — no camera, no actor, no studio.",
  },
  {
    icon: Captions,
    title: "Auto captions",
    description: "Word-by-word animated captions synced to the voiceover, styled to match your brand.",
  },
  {
    icon: Mic2,
    title: "AI voiceover",
    description: "Dozens of natural voices, or clone your own. Swap voices without re-rendering the whole video.",
  },
  {
    icon: Clapperboard,
    title: "Smart b-roll",
    description: "Relevant stock and AI-generated footage matched automatically to what your script is saying.",
  },
];

const steps = [
  { step: "01", title: "Pick a format", description: "Script-to-video, repurpose a long upload, or a UGC-style ad." },
  { step: "02", title: "Let AI assemble it", description: "Script, voiceover, captions, and b-roll come together in one render." },
  { step: "03", title: "Export & post", description: "Download a vertical, platform-ready MP4 for TikTok, Reels, or Shorts." },
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
        <section className="hero-glow relative overflow-hidden px-6 pb-24 pt-24 text-center">
          <Badge variant="outline" className="mx-auto mb-6 w-fit gap-1.5">
            <Sparkles className="h-3 w-3" /> AI short-form video, end to end
          </Badge>
          <h1 className="mx-auto max-w-3xl text-4xl font-bold tracking-tight sm:text-6xl">
            Turn any idea into a{" "}
            <span className="gradient-text">scroll-stopping</span> short video
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-lg text-muted-foreground">
            Clipforge writes the script, generates the voiceover, cuts the b-roll, and captions it —
            so you can post daily without touching an editor.
          </p>
          <div className="mt-10 flex items-center justify-center gap-4">
            <Button asChild size="lg">
              <Link href="/register">Start creating — free</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/pricing">See pricing</Link>
            </Button>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">No credit card required · 50 free credits</p>
        </section>

        <section id="features" className="mx-auto max-w-6xl px-6 py-20">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight">Everything you need to ship shorts daily</h2>
            <p className="mt-4 text-muted-foreground">
              One credit-based workspace instead of five separate tools.
            </p>
          </div>
          <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <Card key={f.title}>
                <CardHeader>
                  <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/15">
                    <f.icon className="h-5 w-5 text-primary" />
                  </div>
                  <CardTitle className="text-base">{f.title}</CardTitle>
                  <CardDescription>{f.description}</CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
        </section>

        <section className="border-y border-border/60 bg-secondary/30 px-6 py-20">
          <div className="mx-auto max-w-6xl">
            <h2 className="text-center text-3xl font-bold tracking-tight">How it works</h2>
            <div className="mt-14 grid gap-10 md:grid-cols-3">
              {steps.map((s) => (
                <div key={s.step} className="text-center">
                  <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-primary/40 text-primary font-semibold">
                    {s.step}
                  </div>
                  <h3 className="text-lg font-semibold">{s.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">{s.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-4xl px-6 py-24 text-center">
          <Zap className="mx-auto mb-4 h-8 w-8 text-primary" />
          <h2 className="text-3xl font-bold tracking-tight">Stop paying an editor for content you can generate</h2>
          <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
            Join creators and brands using Clipforge to keep a daily short-form pipeline running on autopilot.
          </p>
          <Button asChild size="lg" className="mt-8">
            <Link href="/register">Create your first video</Link>
          </Button>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
