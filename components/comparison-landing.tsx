import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Reveal, RevealGroup, RevealItem } from "@/components/reveal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, Minus, Sparkles, X } from "lucide-react";

export interface ComparisonRow {
  feature: string;
  us: string;
  them: string;
  winner: "us" | "them" | "neutral";
}

export interface ComparisonConfig {
  competitorName: string;
  badge: string;
  headline: string;
  subhead: string;
  rows: ComparisonRow[];
  fairnessNote: string;
  advantage: { title: string; body: string };
  ctaHeadline: string;
  ctaBody: string;
}

function Cell({ text, isWinner, isLoser }: { text: string; isWinner: boolean; isLoser: boolean }) {
  return (
    <div className="flex items-start gap-2 text-sm">
      {isWinner && <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />}
      {isLoser && <X className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/50" />}
      {!isWinner && !isLoser && <Minus className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/50" />}
      <span className={isLoser ? "text-muted-foreground" : ""}>{text}</span>
    </div>
  );
}

export function ComparisonLandingPage({ config }: { config: ComparisonConfig }) {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="flex-1">
        <section className="hero-glow grid-pattern px-6 py-20">
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

        <section className="mx-auto max-w-4xl px-6 py-16">
          <Reveal>
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-border bg-secondary/40">
                    <th className="px-4 py-3 text-sm font-semibold">Feature</th>
                    <th className="px-4 py-3 text-sm font-semibold text-primary">Clipforge</th>
                    <th className="px-4 py-3 text-sm font-semibold text-muted-foreground">{config.competitorName}</th>
                  </tr>
                </thead>
                <tbody>
                  {config.rows.map((row, i) => (
                    <tr key={row.feature} className={i % 2 === 0 ? "" : "bg-secondary/20"}>
                      <td className="px-4 py-3 align-top text-sm font-medium">{row.feature}</td>
                      <td className="px-4 py-3 align-top">
                        <Cell text={row.us} isWinner={row.winner === "us"} isLoser={row.winner === "them"} />
                      </td>
                      <td className="px-4 py-3 align-top">
                        <Cell text={row.them} isWinner={row.winner === "them"} isLoser={row.winner === "us"} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">{config.fairnessNote}</p>
          </Reveal>
        </section>

        <section className="border-y border-border bg-secondary/30 px-6 py-16">
          <Reveal>
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-2xl font-bold tracking-tight">{config.advantage.title}</h2>
              <p className="mt-3 text-muted-foreground">{config.advantage.body}</p>
            </div>
          </Reveal>
        </section>

        <section className="px-6 py-24">
          <Reveal>
            <div className="glow-ring mx-auto max-w-2xl">
              <div className="hero-glow rounded-2xl border border-transparent bg-card/60 px-6 py-16 text-center">
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
