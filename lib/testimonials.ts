export interface Testimonial {
  name: string;
  role: string;
  quote: string;
  /** A specific, attributable number, e.g. "Watch time +57%" or "6 hrs/week
   * saved" — generic praise without a real metric behind it doesn't belong
   * here. Optional only because a quote might not have one yet; prefer
   * filling it in over leaving it blank. */
  metric?: string;
}

// Empty by default on purpose — the homepage testimonials section only
// renders when this has entries, so nothing fabricated or placeholder-y
// can ever appear live. Drop in real quotes here (3-5 recommended) and the
// section shows up automatically; remove them and it disappears again.
export const testimonials: Testimonial[] = [];
