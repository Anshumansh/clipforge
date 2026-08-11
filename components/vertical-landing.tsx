import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Reveal, RevealGroup, RevealItem } from "@/components/reveal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { LucideIcon } from "lucide-react";
import { Sparkles } from "lucide-react";

export interface VerticalConfig {
  badge: string;
  headline: string;
  subhead: string;
  painPoint: { title: string; body: string };
  features: { icon: LucideIcon; title: string; body: string }[];
  ctaHeadline: string;
  ctaBody: string;
}

export function VerticalLandingPage({ config }: { config: VerticalConfig }) {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="flex-1">
        <section className="ambient-glow relative px-6 py-20">
          <Reveal>
            <div className="mx-auto max-w-2xl text-center">
              <Badge variant="outline" className="mx-auto mb-6 w-fit gap-1.5 border-primary/30 bg-primary/5">
                <Sparkles className="h-3 w-3 text-primary" /> {config.badge}
              </Badge>
              <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">{config.headline}</h1>
              <p className="mt-4 text-lg text-muted-foreground">{config.subhead}</p>
              <div className="mt-8 flex justify-center gap-3">
                <Button asChild size="lg">
                  <Link href="/register">Start creating — free</Link>
                </Button>
                <Button asChild size="lg" variant="outline">
                  <Link href="/pricing">See pricing</Link>
                </Button>
              </div>
            </div>
          </Reveal>
        </section>

        <section className="border-y border-border bg-secondary/30 px-6 py-16">
          <Reveal>
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-2xl font-bold tracking-tight">{config.painPoint.title}</h2>
              <p className="mt-3 text-muted-foreground">{config.painPoint.body}</p>
            </div>
          </Reveal>
        </section>

        <section className="mx-auto max-w-5xl px-6 py-16">
          <RevealGroup className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {config.features.map((f) => (
              <RevealItem key={f.title}>
                <div className="h-full rounded-xl border border-border bg-card/40 p-6">
                  <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/15">
                    <f.icon className="h-5 w-5 text-primary" />
                  </div>
                  <h3 className="font-semibold">{f.title}</h3>
                  <p className="mt-1.5 text-sm text-muted-foreground">{f.body}</p>
                </div>
              </RevealItem>
            ))}
          </RevealGroup>
        </section>

        <section className="ambient-glow relative px-6 py-24">
          <Reveal>
            <div className="glow-ring mx-auto max-w-2xl">
              <div className="rounded-2xl border border-transparent bg-card/60 px-6 py-16 text-center">
                <h2 className="text-2xl font-bold tracking-tight">{config.ctaHeadline}</h2>
                <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">{config.ctaBody}</p>
                <Button asChild size="lg" className="mt-6">
                  <Link href="/register">Start creating — free</Link>
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
