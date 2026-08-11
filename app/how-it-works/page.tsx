import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Reveal, RevealGroup, RevealItem } from "@/components/reveal";
import { Button } from "@/components/ui/button";
import {
  Wand2,
  Scissors,
  UserRound,
  Radar,
  Search,
  TrendingUp,
  Sparkles,
  ShieldCheck,
} from "lucide-react";

export const metadata: Metadata = {
  title: "How it works",
  description: "The real mechanics behind Clipforge's three generation engines and Trend Radar — not a feature list, how it actually works.",
};

const engines = [
  {
    icon: Wand2,
    title: "Script to video",
    steps: [
      "You paste a topic, a script, or a blog post.",
      "An LLM writes a 30-45 second spoken script, plus 4-6 visual keywords pulled from what the script is actually about.",
      "Those keywords drive a real stock b-roll search — the footage is chosen to match content, not stitched randomly.",
      "Text-to-speech generates the voiceover, word-by-word timing is captured for captions.",
      "Everything renders together — b-roll, captions, voiceover, optional watermark — into one final vertical video.",
    ],
  },
  {
    icon: Scissors,
    title: "Repurpose",
    steps: [
      "You upload a long-form video — a podcast, an interview, a stream.",
      "Audio is transcribed and scanned for highlight-worthy moments.",
      "Each candidate clip gets cut, and the crop automatically tracks whoever's speaking using on-device face detection — no manual reframing.",
      "Captions and a hook-strength score are generated per clip, so you know which one to post first.",
    ],
  },
  {
    icon: UserRound,
    title: "UGC-style ad videos",
    steps: [
      "You describe a product and its selling points.",
      "An ad script is written in a talking-to-camera style, not a generic voiceover-over-b-roll format.",
      "A voiceover is generated and paired with matched b-roll and captions to produce a finished ad — no camera, no actor, no studio.",
    ],
  },
];

const trendSteps = [
  {
    icon: Search,
    title: "Track channels, not just keywords",
    body: "You pick a niche and up to 10 inspiration channels. Every few hours, Clipforge pulls each channel's recent videos through the official YouTube Data API — no scraping, ever.",
  },
  {
    icon: TrendingUp,
    title: "Breakout scoring against each channel's own baseline",
    body: "A video only counts as \"breaking out\" if its view velocity is at least 3x that specific channel's own historical median — never a global popularity bar, since a 10k-subscriber channel and a 10M-subscriber channel have completely different normal. This also means a brand-new tracked channel's feed stays honestly sparse for the first few days: velocity needs real time-spaced observations, so there's no shortcut that doesn't mean fabricating a signal.",
  },
  {
    icon: Sparkles,
    title: "Pattern extraction, never the content itself",
    body: "For videos that clear the breakout threshold, an LLM looks at the title, description, and thumbnail — never the video's actual audio or spoken words — and extracts a structural pattern: hook type, pacing, what emotional beat it's hitting. That pattern is what gets cached and reused, not anything from the source video's actual content.",
  },
  {
    icon: ShieldCheck,
    title: "One tap turns a pattern into your own original script",
    body: "\"Make My Version\" hands that structural pattern to the normal script generator, which writes something new in that style on your own angle. A word-overlap guardrail checks the result against telltale similarity to the source before it's ever shown to you, and automatically retries once if it's too close.",
  },
];

export default function HowItWorksPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="flex-1">
        <section className="px-6 py-20">
          <Reveal>
            <div className="mx-auto max-w-2xl text-center">
              <h1 className="text-4xl font-bold tracking-tight">How Clipforge actually works</h1>
              <p className="mt-4 text-muted-foreground">
                The real mechanics behind each engine — not a feature list.
              </p>
            </div>
          </Reveal>
        </section>

        <section className="mx-auto max-w-5xl px-6 py-16">
          <RevealGroup className="grid gap-6 lg:grid-cols-3">
            {engines.map((engine) => (
              <RevealItem key={engine.title}>
                <div className="h-full rounded-xl border border-border bg-card/40 p-6">
                  <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/15">
                    <engine.icon className="h-5 w-5 text-primary" />
                  </div>
                  <h2 className="font-semibold">{engine.title}</h2>
                  <ol className="mt-3 space-y-2 text-sm text-muted-foreground">
                    {engine.steps.map((step, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="shrink-0 text-primary">{i + 1}.</span>
                        {step}
                      </li>
                    ))}
                  </ol>
                </div>
              </RevealItem>
            ))}
          </RevealGroup>
        </section>

        <section className="border-y border-border/60 bg-secondary/30 px-6 py-20">
          <Reveal>
            <div className="mx-auto max-w-2xl text-center">
              <Radar className="mx-auto mb-4 h-8 w-8 text-primary" />
              <h2 className="text-3xl font-bold tracking-tight">Trend Radar, in real detail</h2>
              <p className="mt-4 text-muted-foreground">
                This is the feature we think most differentiates Clipforge — it deserves more than a homepage FAQ
                answer.
              </p>
            </div>
          </Reveal>
          <RevealGroup className="mx-auto mt-14 grid max-w-3xl gap-8">
            {trendSteps.map((step) => (
              <RevealItem key={step.title}>
                <div className="flex gap-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/15">
                    <step.icon className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold">{step.title}</h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
                  </div>
                </div>
              </RevealItem>
            ))}
          </RevealGroup>
        </section>

        <section className="px-6 py-24">
          <Reveal>
            <div className="glow-ring mx-auto max-w-2xl">
              <div className="rounded-2xl border border-transparent bg-card/60 px-6 py-16 text-center">
                <h2 className="text-2xl font-bold tracking-tight">See it work on your own idea</h2>
                <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
                  Try a real generation on the homepage — no signup required — or create an account for the full
                  pipeline.
                </p>
                <div className="mt-6 flex justify-center gap-3">
                  <Button asChild size="lg">
                    <Link href="/register">Start creating — free</Link>
                  </Button>
                  <Button asChild size="lg" variant="outline">
                    <Link href="/#try-it">Try the demo</Link>
                  </Button>
                </div>
              </div>
            </div>
          </Reveal>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
