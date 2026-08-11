/**
 * Competitor pricing benchmarks (brief section 5) -- dated, sourced, and
 * auto-expiring. Every figure below is exactly what the owner's brief
 * specified ("approximately" -- these are the owner's own research, not
 * independently re-verified by this code at insert time). Vizard is
 * deliberately NOT seeded: the brief explicitly says its pricing is
 * dynamic and must be verified before use, so inventing a number for it
 * would violate "do not invent... competitor information" directly.
 * getActiveCompetitorBenchmarks() filters out anything past the 30-day
 * staleness window, so a forgotten re-verification silently stops
 * appearing in any comparison rather than silently going stale in public.
 */
import { db } from "@/lib/db";

export const COMPETITOR_STALENESS_DAYS = 30;

export interface SeedCompetitorBenchmark {
  competitor: string;
  planName: string;
  priceUsd: number;
  billingPeriod: "monthly" | "annual";
  sourceUrl: string;
  note: string;
}

/** Owner-provided figures from PRICING_OVERHAUL_BRIEF.md section 5, dated
 * to when this pass was written. Re-running seedCompetitorBenchmarks()
 * bumps verifiedAt to "now" -- only do that after actually re-checking the
 * source URL, not just because the seed ran again. */
export const SEED_BENCHMARKS: SeedCompetitorBenchmark[] = [
  {
    competitor: "opusclip",
    planName: "Starter",
    priceUsd: 15,
    billingPeriod: "monthly",
    sourceUrl: "https://www.opus.pro/pricing",
    note: "Approximate, per owner brief 2026-08-11. Not independently re-fetched at insert time.",
  },
  {
    competitor: "opusclip",
    planName: "Pro",
    priceUsd: 29,
    billingPeriod: "monthly",
    sourceUrl: "https://www.opus.pro/pricing",
    note: "Approximate, per owner brief 2026-08-11. Not independently re-fetched at insert time.",
  },
  {
    competitor: "revid",
    planName: "Entry/Growth",
    priceUsd: 39,
    billingPeriod: "monthly",
    sourceUrl: "https://www.revid.ai/pricing",
    note: "Approximate, per owner brief 2026-08-11. Not independently re-fetched at insert time.",
  },
  {
    competitor: "revid",
    planName: "Ultra",
    priceUsd: 199,
    billingPeriod: "monthly",
    sourceUrl: "https://www.revid.ai/pricing",
    note: "Approximate, per owner brief 2026-08-11. Not independently re-fetched at insert time.",
  },
  {
    competitor: "klap",
    planName: "Basic",
    priceUsd: 14,
    billingPeriod: "annual",
    sourceUrl: "https://klap.app/pricing",
    note: "Annual-equivalent monthly price, per owner brief 2026-08-11. Not independently re-fetched at insert time.",
  },
  {
    competitor: "klap",
    planName: "Pro",
    priceUsd: 39,
    billingPeriod: "annual",
    sourceUrl: "https://klap.app/pricing",
    note: "Annual-equivalent monthly price, per owner brief 2026-08-11. Not independently re-fetched at insert time.",
  },
  {
    competitor: "klap",
    planName: "Pro+",
    priceUsd: 94,
    billingPeriod: "annual",
    sourceUrl: "https://klap.app/pricing",
    note: "Annual-equivalent monthly price, per owner brief 2026-08-11. Not independently re-fetched at insert time.",
  },
  // Vizard intentionally omitted -- brief: "verify its dynamic pricing
  // before comparison". No number exists to seed without inventing one.
];

export async function seedCompetitorBenchmarks(now: Date = new Date()): Promise<void> {
  for (const b of SEED_BENCHMARKS) {
    const existing = await db.competitorBenchmark.findFirst({
      where: { competitor: b.competitor, planName: b.planName, billingPeriod: b.billingPeriod },
    });
    if (existing) {
      await db.competitorBenchmark.update({
        where: { id: existing.id },
        data: { priceUsd: b.priceUsd, sourceUrl: b.sourceUrl, note: b.note, verifiedAt: now },
      });
    } else {
      await db.competitorBenchmark.create({
        data: {
          competitor: b.competitor,
          planName: b.planName,
          priceUsd: b.priceUsd,
          billingPeriod: b.billingPeriod,
          sourceUrl: b.sourceUrl,
          note: b.note,
          verifiedAt: now,
        },
      });
    }
  }
}

export function isBenchmarkStale(verifiedAt: Date, now: Date = new Date()): boolean {
  const ageMs = now.getTime() - verifiedAt.getTime();
  return ageMs > COMPETITOR_STALENESS_DAYS * 24 * 60 * 60 * 1000;
}

/** Every non-stale benchmark, for public display or internal comparison.
 * A benchmark whose 30-day window has lapsed is excluded entirely rather
 * than shown with a "stale" label -- the brief says "hide", not "flag". */
export async function getActiveCompetitorBenchmarks(now: Date = new Date()) {
  const all = await db.competitorBenchmark.findMany({ orderBy: [{ competitor: "asc" }, { priceUsd: "asc" }] });
  return all.filter((b) => !isBenchmarkStale(b.verifiedAt, now));
}
