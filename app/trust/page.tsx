import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Reveal, RevealGroup, RevealItem } from "@/components/reveal";
import {
  Lock,
  ShieldCheck,
  EyeOff,
  Trash2,
  Mic2,
  Globe,
  KeyRound,
} from "lucide-react";

export const metadata: Metadata = {
  title: "Trust & data handling",
  description: "How Clipforge actually handles your data — concrete facts, not badges we haven't earned.",
};

const facts = [
  {
    icon: KeyRound,
    title: "Passwords are never stored in plain text",
    description: "Hashed with bcrypt, salted, one-way. We can't read your password and neither can anyone who breaches the database.",
  },
  {
    icon: Lock,
    title: "Connected platform tokens are encrypted at rest",
    description: "TikTok/YouTube/Instagram access tokens are encrypted (AES-256-GCM) in the database, never logged or stored in plain text.",
  },
  {
    icon: EyeOff,
    title: "No ad tracking, no analytics scripts",
    description: "We set a signed session cookie once you're logged in, plus short-lived cookies NextAuth itself uses for CSRF protection and post-login redirects. Nothing else runs on the site to track you — no ad pixels, no analytics scripts.",
  },
  {
    icon: ShieldCheck,
    title: "Generated media is private by default",
    description: "Your videos live in a private bucket, never publicly listable, served only through short-lived signed URLs — not a public S3 path anyone can guess.",
  },
  {
    icon: Mic2,
    title: "Voice samples are used only for your own render",
    description: "A reference clip you upload for voice cloning is never used to train a shared model or touch any other user's generation.",
  },
  {
    icon: Trash2,
    title: "Account deletion is real and self-service",
    description: "Dashboard → Billing → Delete account removes your projects, generated media, connected tokens, and voice samples immediately — not a support ticket queue.",
  },
  {
    icon: Globe,
    title: "HTTPS everywhere, with real security headers",
    description: "HSTS, X-Frame-Options, X-Content-Type-Options, and a restrictive Permissions-Policy are set on every response.",
  },
];

const processors = [
  "OpenAI / Groq — script writing, transcription, text-to-speech",
  "Microsoft Edge TTS — free-tier text-to-speech fallback",
  "Pexels — stock b-roll matching",
  "Stripe — payment processing (we never see your card number)",
  "Backblaze B2 — storage of generated media",
  "Resend — transactional email delivery only",
  "Google (YouTube Data API) — Trend Radar data, YouTube publishing",
];

export default function TrustPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="flex-1">
        <section className="ambient-glow relative px-6 py-20">
          <Reveal>
            <div className="mx-auto max-w-2xl text-center">
              <h1 className="text-4xl font-bold tracking-tight">How we actually handle your data</h1>
              <p className="mt-4 text-muted-foreground">
                Concrete facts about what's built, not marketing claims. Where something isn't true yet, we say so
                below instead of implying otherwise.
              </p>
            </div>
          </Reveal>
        </section>

        <section className="mx-auto max-w-5xl px-6 py-16">
          <RevealGroup className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {facts.map((f) => (
              <RevealItem key={f.title}>
                <div className="h-full rounded-xl border border-border bg-card/40 p-6">
                  <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/15">
                    <f.icon className="h-5 w-5 text-primary" />
                  </div>
                  <h3 className="font-semibold">{f.title}</h3>
                  <p className="mt-1.5 text-sm text-muted-foreground">{f.description}</p>
                </div>
              </RevealItem>
            ))}
          </RevealGroup>
        </section>

        <section className="border-y border-border/60 bg-secondary/30 px-6 py-16">
          <Reveal>
            <div className="mx-auto max-w-2xl">
              <h2 className="text-xl font-bold tracking-tight">Where your data actually goes</h2>
              <p className="mt-3 text-sm text-muted-foreground">
                Generating a video means sending relevant parts of your input to whichever provider powers that
                specific step. We only send each provider what that feature requires — never everything.
              </p>
              <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
                {processors.map((p) => (
                  <li key={p} className="flex gap-2">
                    <span className="text-primary">•</span>
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
        </section>

        <section className="mx-auto max-w-2xl px-6 py-16">
          <Reveal>
            <h2 className="text-xl font-bold tracking-tight">Where we're honest about not being there yet</h2>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              We don't currently hold SOC 2 or any other third-party security certification, and you won't find
              that badge anywhere on this site until it's actually true. Clipforge is operated as a sole
              proprietorship today, not a larger organization with a dedicated compliance team. If a formal audit
              or certification is a real requirement for your team, email us directly — we'd rather have that
              conversation honestly than put up a badge that isn't earned.
            </p>
            <p className="mt-6 text-sm text-muted-foreground">
              Full details in the{" "}
              <Link href="/privacy" className="text-primary underline underline-offset-2 hover:no-underline">
                Privacy Policy
              </Link>{" "}
              and{" "}
              <Link href="/terms" className="text-primary underline underline-offset-2 hover:no-underline">
                Terms of Service
              </Link>
              . Questions go to{" "}
              <a href="mailto:support@forgecut.app" className="text-primary underline underline-offset-2 hover:no-underline">
                support@forgecut.app
              </a>
              .
            </p>
          </Reveal>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
