import { cn } from "@/lib/utils";

/** Infinite horizontal ticker. Renders the item list twice back-to-back and
 * animates exactly -50%, so the seam between loops is invisible — no JS
 * measurement or scroll math needed. */
export function Marquee({ items, className }: { items: string[]; className?: string }) {
  return (
    <div className={cn("relative overflow-hidden", className)} aria-hidden="true">
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-16 bg-gradient-to-r from-background to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-16 bg-gradient-to-l from-background to-transparent" />
      <div className="marquee-track flex w-max gap-3">
        {[...items, ...items].map((item, i) => (
          <span
            key={i}
            className="flex items-center gap-2 whitespace-nowrap rounded-full border border-border/60 bg-card/40 px-4 py-2 text-sm text-muted-foreground"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}
