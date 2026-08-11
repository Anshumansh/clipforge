# Pricing Model — 2026-08-v1

Source of truth: `lib/pricing/plan-config.ts`'s `PLAN_CONFIGS`. Every number below is
copied from that file, which is copied verbatim from `PRICING_OVERHAUL_BRIEF.md`.
This document explains the model; the code is the actual source of truth if the two
ever disagree.

**Status: not live.** Every plan below exists only behind `PRICING_V2_ENABLED`
(currently unset/false everywhere, including production). See
`PRICING_DEPLOYMENT_CHECKLIST.md` for what has to happen before any of this reaches
a real customer.

## Plans

| Plan | Monthly | Annual (/mo equiv) | Credits/mo | Max res | Workflows | Voice clone | Brand presets | Seats | Retention | API/MCP |
|---|---|---|---|---|---|---|---|---|---|---|
| Free | $0 | — | 20 (one-time) | 720p | Script only, ≤30s | No | 0 | 1 | — | None |
| Starter | $15 | $12.00 | 250 | 1080p | Script only | No | 1 | 1 | — | None |
| Creator | $29 | $23.17 | 600 | 1080p | + Repurpose, UGC | No | 2 | 1 | 30 days | None |
| Pro | $59 | $47.17 | 1,500 | 4K | + Repurpose, UGC | Yes | 5 | 2 | 60 days | Limited |
| Business | $119 | $95.17 | 3,500 | 4K | + Repurpose, UGC | Yes | 10 | 5 | 90 days | Higher, limited |
| Enterprise | Custom | Custom | Custom | 4K | Everything in Business | Yes | Custom | Custom | Custom | Custom |

Free's 20 credits are granted once, on email verification — not a recurring monthly
grant. Every other plan's credits refresh with the billing cycle; annual plans
release credits monthly rather than all at once (brief section 2).

Social publishing (Creator+) is additionally gated by the existing
`lib/social/platforms.ts` per-platform verified-live status — a plan entitles an
account to connect a platform once that platform is actually operational, not before.

Enterprise deliberately lists only what's real: more of what Business already has.
No SOC 2, ISO, SSO, SLA, or data-residency claim exists here or should be added
without independent verification that it's true.

## Annual discount

Capped at 20% off 12x monthly, per the brief. The brief's own figures round down to
the nearest whole dollar rather than hitting exactly 20.00% (e.g. Creator:
$29 × 12 = $348; 20% off = $278.40; the brief specifies $278) — every plan is
verified in `lib/pricing/plan-config.test.ts` to sit within $1 of the 20% line.

## Credit cost table

Canonical implementation: `lib/pricing/credit-calculator.ts`. This is the *only*
place a credit cost should ever be computed — the website, API/MCP surface,
dashboard, and rendering worker must all call these functions rather than
duplicating a number.

| Workflow | Cost |
|---|---|
| Standard video, 30–45s | 10 credits |
| Standard video, 46–60s | 15 credits |
| Standard video, 61–90s | 25 credits |
| UGC-style ad (flat, any duration) | 15 credits |
| Repurpose — source processing | 2 credits / uploaded minute (rounded up) |
| Repurpose — per completed clip | 10 credits (charged only as each clip actually finishes) |
| Thumbnail | 1 credit |
| Premium voice | +3 credits |
| Additional aspect ratio (each) | +3 credits |
| 4K export | +15 credits |
| Voice cloning | +30 credits (a floor, not a fixed price — see `UNIT_ECONOMICS.md`) |

Durations beyond 90 seconds are **not priced** — `creditsForStandardVideo()` throws
`UnpricedDurationError` rather than extrapolating a number the brief never specified.
Pricing longer-form standard videos is an open owner decision (see
`OWNER_ACTIONS_REQUIRED.md`).

The brief's own worked example — a 30-minute upload producing 5 clips — is a pinned
test case: 60 source credits + 50 clip credits = 110 total. Confirmed exact in
`lib/pricing/credit-calculator.test.ts`.

Required pricing-page explanation (verbatim, brief section 10): *"Standard 30–45
second videos use 10 credits. Long uploads, voice cloning, 4K and additional outputs
use more credits. Clipforge shows the exact cost before every generation."* This
copy is live on the new pricing page today (`components/pricing-v2.tsx`).

## What "one credit equals one minute" claims have been removed

None existed to remove in the new page — the legacy pricing page's flat-rate framing
("Every generated video costs a flat 10 credits, regardless of length") stays
accurate for the *current* live system since that's genuinely still how
`lib/credits.ts` charges today. It will need updating in the same pass that cuts
production over to the new calculator (do not update the copy before the pricing
engine is actually live — that would make the live page describe behavior the app
doesn't yet have).
