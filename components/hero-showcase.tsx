"use client";

import { useState } from "react";
import { PhoneMockup } from "@/components/phone-showcase";
import { cn } from "@/lib/utils";

interface Clip {
  src: string;
  label: string;
}

/** Hero phone mockup with tappable "reel" shortcuts underneath — lets a
 * visitor preview any of the three real output types without scrolling down
 * to the showcase section. PhoneMockup's own load-triggered fade-in handles
 * the transition between clips, so this just swaps which src it's given. */
export function HeroShowcase({ clips }: { clips: Clip[] }) {
  const [active, setActive] = useState(0);

  return (
    <div className="mx-auto w-full max-w-[280px] lg:mx-0">
      <PhoneMockup src={clips[active].src} label={clips[active].label} lazy={false} />

      <div className="mt-5 flex justify-center gap-2 lg:justify-start">
        {clips.map((clip, i) => (
          <button
            key={clip.src}
            type="button"
            onClick={() => setActive(i)}
            aria-label={`Preview: ${clip.label}`}
            aria-pressed={i === active}
            className={cn(
              "rounded-full border px-3 py-1.5 text-xs font-medium transition-all duration-200",
              i === active
                ? "border-primary/60 bg-primary/15 text-foreground shadow-sm shadow-primary/20"
                : "border-border/60 bg-card/40 text-muted-foreground hover:border-primary/30 hover:text-foreground"
            )}
          >
            {clip.label}
          </button>
        ))}
      </div>
    </div>
  );
}
