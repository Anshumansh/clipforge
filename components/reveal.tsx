"use client";

import { motion, type Variants } from "framer-motion";

const variants: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0 },
};

// No vertical movement, just a quick fade — for large above-the-fold text
// (hero headline/subhead). A moving, partially-transparent heading caught
// mid-transition (slow paint, a screenshot, a shared link preview) reads as
// broken/ghosted text; a pure opacity fade never has that failure mode and
// finishes fast enough that almost no one sees the transition at all.
const fastVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
};

/** Fades + slides a section in once as it scrolls into view. Kept dependency-light
 * (framer-motion only) rather than hand-rolling IntersectionObserver plumbing per
 * section, since nearly every marketing section on the site needs this. */
export function Reveal({
  children,
  className,
  delay = 0,
  fast = false,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  /** Use for above-the-fold text where a moving/translating fade risks being
   * caught mid-transition and looking broken rather than animated. */
  fast?: boolean;
}) {
  return (
    <motion.div
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: fast ? 0.25 : 0.5, delay, ease: "easeOut" }}
      variants={fast ? fastVariants : variants}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/** Reveals a grid of children with a staggered delay per item. */
export function RevealGroup({
  children,
  className,
  stagger = 0.08,
}: {
  children: React.ReactNode;
  className?: string;
  stagger?: number;
}) {
  return (
    <motion.div
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "-80px" }}
      transition={{ staggerChildren: stagger }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function RevealItem({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.div variants={variants} transition={{ duration: 0.5, ease: "easeOut" }} className={className}>
      {children}
    </motion.div>
  );
}
