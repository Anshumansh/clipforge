"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useInView } from "framer-motion";
import { cn } from "@/lib/utils";

/** A phone-frame with a real, muted, autoplaying/looping Clipforge output inside —
 * not stock or staged footage. The video's `src` is only set once the frame
 * scrolls near the viewport, so a page visitor who never scrolls never pays for
 * the download (some of these renders are 10-30MB). */
export function PhoneMockup({
  src,
  label,
  className,
  float = true,
  lazy = true,
}: {
  src: string;
  label: string;
  className?: string;
  float?: boolean;
  /** Defer loading the video until it scrolls near the viewport. Set false for
   * anything rendered above the fold — it's visible immediately anyway, so
   * gating it behind IntersectionObserver only adds a dependency for no benefit. */
  lazy?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const observedInView = useInView(ref, { once: true, margin: "200px" });
  const inView = lazy ? observedInView : true;
  const [loaded, setLoaded] = useState(false);

  // A <video>'s src ATTRIBUTE updates reactively like any other prop, but the
  // browser doesn't re-run resource selection just because it changed — the
  // spec only does that on an explicit .load() call. Without this, swapping
  // src on an already-playing <video> (e.g. a "preview a different clip"
  // switcher) silently keeps playing the old clip forever.
  useEffect(() => {
    if (!inView) return;
    setLoaded(false);
    videoRef.current?.load();
  }, [src, inView]);

  return (
    <motion.div
      ref={ref}
      className={cn("relative", className)}
      animate={float ? { y: [0, -10, 0] } : undefined}
      transition={float ? { duration: 5, repeat: Infinity, ease: "easeInOut" } : undefined}
    >
      <div className="glow-ring rounded-[2rem]">
        <div className="relative aspect-[9/19.5] w-full overflow-hidden rounded-[2rem] border-4 border-black/40 bg-black shadow-2xl shadow-primary/20">
          {inView && (
            <video
              ref={videoRef}
              src={src}
              muted
              loop
              autoPlay
              playsInline
              preload="metadata"
              onCanPlay={() => setLoaded(true)}
              className={cn(
                "h-full w-full object-cover transition-opacity duration-700",
                loaded ? "opacity-100" : "opacity-0"
              )}
            />
          )}
          {!loaded && (
            <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-primary/20 to-accent/20">
              <div className="h-8 w-8 animate-pulse rounded-full bg-primary/40" />
            </div>
          )}
          {/* Notch */}
          <div className="absolute left-1/2 top-2 h-4 w-20 -translate-x-1/2 rounded-full bg-black" />
        </div>
      </div>
      <p className="mt-4 text-center text-sm font-medium text-muted-foreground">{label}</p>
    </motion.div>
  );
}
