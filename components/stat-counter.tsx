"use client";

import { useEffect, useRef, useState } from "react";
import { useInView } from "framer-motion";

/** Animates from 0 up to a real, static target number once it scrolls into
 * view — purely a presentation effect, the number itself is never invented.
 * Initial render (and anything that never gets a chance to run the effect —
 * search crawlers, slow/no JS) shows the real value directly, never 0, so
 * the count-up is a bonus for capable browsers rather than the only path
 * to correct content. */
export function StatCounter({ value, suffix = "", prefix = "" }: { value: number; suffix?: string; prefix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const [display, setDisplay] = useState(value);

  useEffect(() => {
    if (!inView) return;
    setDisplay(0);
    const duration = 900;
    const start = performance.now();
    let frame: number;

    function tick(now: number) {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - (1 - progress) ** 3;
      setDisplay(Math.round(eased * value));
      if (progress < 1) frame = requestAnimationFrame(tick);
    }

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [inView, value]);

  return (
    <span ref={ref}>
      {prefix}
      {display}
      {suffix}
    </span>
  );
}
