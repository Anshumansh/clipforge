import { Reveal, RevealGroup, RevealItem } from "@/components/reveal";
import { testimonials } from "@/lib/testimonials";
import { Quote } from "lucide-react";

/** Renders nothing until lib/testimonials.ts has real quotes in it — see
 * that file for why this is empty by default. */
export function TestimonialsSection() {
  if (testimonials.length === 0) return null;

  return (
    <section className="mx-auto max-w-6xl px-6 py-20">
      <Reveal>
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight">What creators are saying</h2>
        </div>
      </Reveal>
      <RevealGroup className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {testimonials.map((t) => (
          <RevealItem key={t.name}>
            <div className="flex h-full flex-col rounded-xl border border-border bg-card/60 p-6">
              <Quote className="h-5 w-5 text-primary" />
              {t.metric && (
                <p className="gradient-text mt-3 text-2xl font-bold tracking-tight">{t.metric}</p>
              )}
              <p className="mt-3 flex-1 text-sm leading-relaxed text-foreground">"{t.quote}"</p>
              <div className="mt-4">
                <p className="text-sm font-semibold">{t.name}</p>
                <p className="text-xs text-muted-foreground">{t.role}</p>
              </div>
            </div>
          </RevealItem>
        ))}
      </RevealGroup>
    </section>
  );
}
