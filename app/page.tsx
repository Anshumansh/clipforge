import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Reveal, RevealGroup, RevealItem } from "@/components/reveal";
import { PhoneMockup } from "@/components/phone-showcase";
import { HeroDemo } from "@/components/hero-demo";
import { StatCounter } from "@/components/stat-counter";
import { Marquee } from "@/components/marquee";
import { db } from "@/lib/db";
import { SOCIAL_PLATFORMS, PLATFORM_LABELS, getLivePlatforms } from "@/lib/social/platforms";
import { getPresignedDownloadUrl, getAppBaseUrl, objectExists, copyObject } from "@/lib/storage";
import { unstable_cache } from "next/cache";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
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
  Users,
  Wand2,
  Zap,
} from "lucide-react";

// This page has no dynamic APIs, so Next would otherwise treat it as fully
// static: rendered exactly once at Docker build time (with no real
// DATABASE_URL available then, since .dockerignore keeps .env out of the
// build context — see Dockerfile) and served as that same fixed HTML
// forever after. Without this, unstable_cache's revalidate window below is
// meaningless: nothing would ever call the cached function again to trigger
// a refresh. This makes the route ISR — background-regenerated against the
// real running server (real DB access) on access after the interval.
export const revalidate = 300;

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
    title: "UGC-style ad videos",
    description: "Turn a product description into a voiced, captioned ad with matched b-roll — no camera, no actor, no studio.",
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
    title: "Publish straight from the editor",
    description:
      "Connect TikTok, Instagram, and YouTube once — publishing goes live for each platform as its developer approval clears, no manual re-upload once it does.",
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

const stats = [
  { value: 3, suffix: "", label: "AI generation engines, one credit pool" },
  { value: 50, suffix: "", label: "free credits to start — no card" },
  { value: 3, suffix: "", label: "platforms in the social publishing pipeline" },
  { value: 0, prefix: "$", suffix: "", label: "extra cost for voice cloning on Business" },
];

const quickLinks = [
  { href: "/#features", label: "Explore features" },
  { href: "/#how-it-works", label: "See how it works" },
  { href: "/pricing", label: "View pricing" },
  { href: "/#faq", label: "Read the FAQ" },
  { href: "/register", label: "Sign up free →" },
];

const tickerItems = [
  "Script to video",
  "Podcast → Shorts",
  "UGC-style ad videos",
  "Voice cloning",
  "Auto captions",
  "Smart b-roll",
  "Hook scoring",
  "Social publishing (beta)",
  "Trend Radar",
];

// Real, unedited renders pulled straight from production — not stock footage or
// staged mockups. Muted/looped in the phone frames below.
//
// Each entry's `key` is a permanent, account-independent storage object --
// NOT a job/project-scoped key. That distinction is load-bearing: an earlier
// version of this pointed straight at real render outputs
// (media/<userId>/<projectId>/... and jobs/<jobId>/attempts/...), which
// broke twice for two different reasons: (1) those keys are ownership-gated
// by /api/media/[...key] and only stayed reachable by anonymous visitors as
// long as presigning happened to succeed server-side -- once that fell back
// (see ensureShowcaseAssets below), anonymous requests 404'd; (2) they're
// one project deletion (or, briefly considered as a fix, one demo-account
// 24h cleanup sweep -- see app/api/demo/cleanup/route.ts) away from vanishing
// under a public marketing page with no warning. `showcase/<env>/*.mp4` has
// no Project/Job row at all, so neither risk applies -- it's presigned
// directly with zero ownership check, matching the demo-account carve-out's
// intent (public by design) without the demo account's lifecycle risk.
// Resolved inside a function, NOT as a module-level constant -- confirmed
// live that a module-scope `process.env.RAILWAY_ENVIRONMENT_NAME` read here
// baked in "production" (the `??` fallback) on the staging deploy itself:
// Next.js can evaluate module scope during the build step, before Railway's
// runtime env vars are injected, while code inside a request/handler body
// (like /api/version's GET, which reads the same variable correctly) runs
// at real request time and sees the actual runtime value.
function getShowcaseClipDefs(): { key: string; sourceKey: string; label: string }[] {
  const env = process.env.RAILWAY_ENVIRONMENT_NAME ?? "production";
  return [
    {
      key: `showcase/${env}/script.mp4`,
      sourceKey: "jobs/cmt6jv25i000jkvvgh9hvyc41/attempts/9a73c847-4c61-49d3-8984-10409a58c271/output.mp4",
      label: "Script to video",
    },
    {
      key: `showcase/${env}/repurpose.mp4`,
      sourceKey:
        "jobs/cmt7cquhm000g12izqxtzt1o5/attempts/3787a716-69e5-4014-99fb-092373bdcd01/clip-cmt7cqw670005bf77mteof8ax.mp4",
      label: "Repurpose — auto face tracking",
    },
    {
      key: `showcase/${env}/ugc.mp4`,
      sourceKey: "jobs/cmt7ctbxp000q12iz01r8jdz4/attempts/a329f508-8492-4d27-9944-62bb5bf7b9b4/output.mp4",
      label: "UGC-style ad",
    },
  ];
}

/** Self-healing: copies each source render into its permanent showcase key
 * the first time it's missing (checked via a cheap HEAD, so every call after
 * the first is a no-op). Deliberately not a one-off migration script --
 * running this as part of the page's own request path means restoring a
 * showcase asset never depends on remembering to re-run something by hand,
 * and there's no new admin surface or secret to gate a dedicated endpoint
 * with. The copy runs entirely inside this process using storage credentials
 * it already holds; no bytes pass through the client.
 *
 * Each copy is caught independently, not run inside one Promise.all -- a
 * single failing copy (e.g. a source render that's since been deleted)
 * must not take the other two showcase clips down with it, and must not
 * throw out of the homepage's render path entirely (an unstable_cache
 * rejection here previously meant every request kept re-hitting whichever
 * stale value the cache last had, with no visible signal that the retry
 * itself was silently failing every time). */
async function ensureShowcaseAssets(clips: { key: string; sourceKey: string }[]): Promise<void> {
  await Promise.all(
    clips.map(async ({ key, sourceKey }) => {
      try {
        if (await objectExists(key)) return;
        await copyObject(sourceKey, key);
      } catch (err) {
        console.error(`showcase asset copy failed for ${key} (source: ${sourceKey}):`, err);
      }
    })
  );
}

// Presigned URLs are valid 1h; revalidating well inside that window means a
// served URL still has plenty of life left, same pattern as
// getVideosGeneratedCount below (this page has no dynamic APIs, so it would
// otherwise statically prerender once at build time and freeze).
const getShowcaseClips = unstable_cache(
  async (): Promise<{ src: string; label: string }[]> => {
    const clips = getShowcaseClipDefs();
    await ensureShowcaseAssets(clips);
    return Promise.all(
      clips.map(async ({ key, label }) => {
        const signed = await getPresignedDownloadUrl(key, 3600);
        return { src: signed ?? `${getAppBaseUrl()}/api/media/${key}`, label };
      })
    );
  },
  // Bump this key (not just the code) whenever SHOWCASE_CLIPS' keys change --
  // self-hosted Next.js's unstable_cache data cache is not reliably reset by
  // a new deploy (confirmed live: switching these from job-scoped keys to
  // showcase/<env>/*.mp4 kept serving the pre-change result for multiple
  // deploys in a row, still inside the 30-minute revalidate window). A
  // literal key change is the only thing guaranteed to bypass a stale entry.
  ["homepage-showcase-clips-v2"],
  { revalidate: 1800 }
);

const differentiators = [
  {
    title: "Three engines, one credit pool",
    description:
      "Script-to-video, long-form repurposing, and UGC ad generation each usually mean a separate subscription elsewhere. In Clipforge they share one credit pool and one dashboard, so switching between a talking-head ad and a podcast clip doesn't mean switching tools.",
  },
  {
    title: "Voice cloning included, not upsold per word",
    description:
      "Most voice-cloning tools charge by the character or the minute on top of your plan. Clipforge's Business tier includes it flat — narrate every video in your own voice at no extra per-word cost.",
  },
  {
    title: "Publishing built in, not bolted on",
    description:
      "Connect TikTok, Instagram, and YouTube from the editor — no downloading a file just to re-upload it somewhere else. Publishing goes live per platform as developer approval clears; connected accounts are ready the moment it does.",
  },
  {
    title: "Built for a daily pipeline, not a demo",
    description:
      "A bounded-concurrency render queue keeps output fast and stable even when your whole team queues renders at once — this runs the same infrastructure in production, not a lighter demo path.",
  },
];

const faqs = [
  {
    q: "Is Clipforge actually free to try?",
    a: "Yes — every new account gets 50 free credits with no credit card required. That's enough to generate several full videos across any of the three engines before you'd need to upgrade.",
  },
  {
    q: "Do I own the videos Clipforge generates?",
    a: "Yes. You own the output Clipforge renders for you, the same as any footage or script you upload. See our Terms of Service for the full breakdown.",
  },
  {
    q: "What's the difference between Script-to-Video, Repurpose, and UGC ads?",
    a: "Script-to-Video turns a topic, script, or article into a finished short from scratch. Repurpose takes a long podcast or YouTube upload and automatically cuts it into vertical highlight clips, with the camera tracking whoever's speaking. UGC ads turn a product description into a voiced, captioned ad with matched b-roll in a talking-to-camera script style — no camera or actor required.",
  },
  {
    q: "Can I really clone my own voice?",
    a: "Yes, on the Business plan. Upload a clean 10-30 second sample and Clipforge narrates every generated video in that voice instead of a stock one. You confirm you own the voice (or have explicit consent to clone it) before it's used — see our voice-cloning consent policy.",
  },
  {
    q: "Which platforms can I auto-publish to?",
    a: "TikTok, Instagram Reels, and YouTube Shorts publishing is built and connects from your dashboard settings. It goes live for each platform once that platform's developer app clears review — until then, downloading a finished render and posting it yourself takes seconds.",
  },
  {
    q: "Is Trend Radar just copying other creators' videos?",
    a: "No — Trend Radar analyzes public YouTube metadata (titles, descriptions, thumbnails, engagement) via the official YouTube Data API to identify structural patterns, never the actual audio or spoken content of a video. It then generates an original script inspired by that structure, not a copy of anyone's video.",
  },
  {
    q: "What happens to my data if I cancel or delete my account?",
    a: "You can permanently delete your account and all associated media at any time from Billing settings — it cancels any active subscription and removes your stored files, not just the database rows referencing them.",
  },
];

const structuredData = [
  {
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
  },
  {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Clipforge",
    url: "https://forgecut.app",
    logo: "https://forgecut.app/icon.svg",
    description: "AI short-form video generation platform for creators and brands.",
  },
  {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  },
];

// This page has no dynamic APIs (no cookies/headers/searchParams), so Next
// statically prerenders it at build time by default — which would otherwise
// bake this count in permanently from whatever the CI build environment saw
// (a dummy, unreachable DATABASE_URL there — see deploy.yml). unstable_cache
// makes this one value revalidate on a timer against the real production DB
// once the page is actually running, instead of freezing at a build-time
// snapshot that never updates.
const getVideosGeneratedCount = unstable_cache(
  async (): Promise<number> => {
    try {
      return await db.project.count({ where: { status: "ready" } });
    } catch {
      return 0;
    }
  },
  ["homepage-videos-generated-count"],
  { revalidate: 300 }
);

const PLATFORM_DOT: Record<(typeof SOCIAL_PLATFORMS)[number], string> = {
  tiktok: "bg-[#25F4EE]",
  instagram: "bg-gradient-to-br from-[#f09433] via-[#e6683c] to-[#bc1888]",
  youtube: "bg-[#FF0000]",
};

export default async function LandingPage() {
  const videosGenerated = await getVideosGeneratedCount();
  const livePlatforms = getLivePlatforms();
  const showcaseClips = await getShowcaseClips();

  return (
    <div className="flex min-h-screen flex-col">
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <SiteHeader />
      <main className="flex-1">
        <section id="try-it" className="ambient-glow relative overflow-hidden px-6 pb-14 pt-16">
          <div className="mx-auto grid max-w-6xl items-start gap-16 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="text-center lg:text-left">
              <Reveal fast>
                <Badge variant="outline" className="mx-auto mb-6 w-fit gap-1.5 border-primary/30 bg-primary/5 lg:mx-0">
                  <Sparkles className="h-3 w-3 text-primary" /> AI short-form video, end to end
                </Badge>
              </Reveal>
              <Reveal fast delay={0.05}>
                <h1 className="mx-auto max-w-xl text-4xl font-bold tracking-tight sm:text-6xl lg:mx-0">
                  Your next <span className="gradient-text">scroll-stopping</span> short is one prompt away
                </h1>
              </Reveal>
              <Reveal fast delay={0.1}>
                <p className="mx-auto mt-6 max-w-xl text-lg text-muted-foreground lg:mx-0">
                  Clipforge writes the script, generates the voiceover, cuts the b-roll, and captions it — connect
                  TikTok, Reels, and Shorts for one-click publishing as each platform's approval clears.
                </p>
              </Reveal>
              <Reveal fast delay={0.15}>
                <div className="mt-10 flex flex-wrap items-center justify-center gap-4 lg:justify-start">
                  <Button asChild size="lg" className="pulse-ring">
                    <Link href="/register">Sign up free</Link>
                  </Button>
                  <Button asChild size="lg" variant="outline">
                    <Link href="/pricing">See pricing</Link>
                  </Button>
                  <Link
                    href="/login"
                    className="text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                  >
                    Already have an account? Log in
                  </Link>
                </div>
                <p className="mt-4 text-xs text-muted-foreground">No credit card required · 50 free credits</p>
                {videosGenerated > 0 && (
                  <div className="mx-auto mt-4 flex w-fit items-center gap-1.5 rounded-full border border-border bg-card/40 px-3 py-1.5 text-xs text-muted-foreground lg:mx-0">
                    <Users className="h-3.5 w-3.5 text-primary" />
                    <StatCounter value={videosGenerated} /> videos generated on Clipforge and counting
                  </div>
                )}
              </Reveal>

              <Reveal delay={0.2}>
                <div className="mx-auto mt-10 grid max-w-md grid-cols-2 gap-3 sm:grid-cols-4 lg:mx-0">
                  {[
                    { icon: Wand2, label: "3 generation engines" },
                    { icon: Mic2, label: "Free voice cloning" },
                    {
                      icon: Share2,
                      label:
                        livePlatforms.length > 0
                          ? `Auto-publish (${livePlatforms.length} live)`
                          : "Connect & auto-publish (beta)",
                    },
                    { icon: Coins, label: "One shared credit pool" },
                  ].map((s) => (
                    <div
                      key={s.label}
                      className="flex flex-col items-center gap-2 rounded-xl border border-border bg-card/60 px-3 py-4 text-center text-xs text-muted-foreground transition-colors hover:border-primary/50 lg:items-start lg:text-left"
                    >
                      <s.icon className="h-4 w-4 text-primary" />
                      {s.label}
                    </div>
                  ))}
                </div>
              </Reveal>

              <Reveal delay={0.25}>
                {livePlatforms.length > 0 ? (
                  <div className="mx-auto mt-8 flex max-w-md flex-wrap items-center justify-center gap-2 lg:mx-0 lg:justify-start">
                    <span className="text-xs text-muted-foreground">Publish straight to:</span>
                    {livePlatforms.map((p) => (
                      <span
                        key={p}
                        className="flex items-center gap-1.5 rounded-full border border-border bg-card/60 px-3 py-1 text-xs font-medium"
                      >
                        <span className={`h-2 w-2 rounded-full ${PLATFORM_DOT[p]}`} />
                        {PLATFORM_LABELS[p]}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="mx-auto mt-8 max-w-md text-center text-xs text-muted-foreground lg:mx-0 lg:text-left">
                    Social publishing (TikTok, Reels, Shorts) connects from your dashboard — going live per platform
                    as developer approval clears.
                  </p>
                )}
              </Reveal>
            </div>

            <Reveal delay={0.2}>
              <HeroDemo clips={showcaseClips} />
            </Reveal>
          </div>
        </section>

        <div className="border-y border-border/60 bg-secondary/20 py-4">
          <Marquee items={tickerItems} />
        </div>

        <section className="px-6 py-16">
          <RevealGroup className="mx-auto grid max-w-5xl grid-cols-2 gap-6 sm:grid-cols-4">
            {stats.map((s) => (
              <RevealItem key={s.label} className="text-center">
                <div className="gradient-text text-4xl font-bold tracking-tight sm:text-5xl">
                  <StatCounter value={s.value} prefix={s.prefix} suffix={s.suffix} />
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{s.label}</p>
              </RevealItem>
            ))}
          </RevealGroup>

          <Reveal delay={0.1}>
            <div className="mx-auto mt-10 flex max-w-3xl flex-wrap items-center justify-center gap-3">
              {quickLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    "rounded-full border px-4 py-2 text-sm font-medium transition-all duration-200",
                    link.href === "/register"
                      ? "border-primary/50 bg-primary/15 text-foreground hover:bg-primary/25"
                      : "border-border/60 bg-card/40 text-muted-foreground hover:border-primary/40 hover:text-foreground"
                  )}
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </Reveal>
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

        <section id="faq" className="border-y border-border/60 bg-secondary/30 px-6 py-20">
          <Reveal>
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-bold tracking-tight">Frequently asked questions</h2>
            </div>
          </Reveal>
          <RevealGroup className="mx-auto mt-12 max-w-3xl space-y-3">
            {faqs.map((f) => (
              <RevealItem key={f.q}>
                <details className="group rounded-xl border border-border/60 bg-card/40 px-6 py-4 open:border-primary/40">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">
                    {f.q}
                    <span className="shrink-0 text-primary transition-transform duration-200 group-open:rotate-45">
                      +
                    </span>
                  </summary>
                  <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{f.a}</p>
                </details>
              </RevealItem>
            ))}
          </RevealGroup>
        </section>

        <section className="ambient-glow relative px-6 py-24">
          <Reveal>
            <div className="glow-ring mx-auto max-w-4xl">
              <div className="rounded-2xl border border-transparent bg-card/60 px-6 py-16 text-center">
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
