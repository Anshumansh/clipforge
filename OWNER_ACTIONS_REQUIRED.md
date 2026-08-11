# Owner Actions Required — Pricing Overhaul

Every item here needs a decision or a real number only the owner has. Nothing in
this list has been guessed at or defaulted around in the code — where a value is
needed and unavailable, the code leaves it `null`/unset rather than inventing one.

## Cost rates (blocks real margin math — `UNIT_ECONOMICS.md`)

Set these as env vars once known (all currently unset; every dependent cost field
stays `null` until they are):

- `COST_RATE_AI_INPUT_PER_1K_TOKENS_USD` / `COST_RATE_AI_OUTPUT_PER_1K_TOKENS_USD` —
  current OpenAI/Groq pricing for whichever model is actually in use in production
  (check the live model config, then the provider's current published rate card —
  don't reuse a memorized figure, these change).
- `COST_RATE_TRANSCRIPTION_PER_MINUTE_USD` — same, for whichever transcription
  provider/model is live.
- `COST_RATE_TTS_PER_CHARACTER_USD` — same, for the TTS provider in use.
- `COST_RATE_VOICE_CLONE_COMPUTE_PER_SECOND_USD` — this one has no external price;
  it's your own estimate of what a second of the self-hosted Coqui XTTS-v2 compute
  costs on the render VPS (Hetzner instance cost ÷ realistic throughput).
- `COST_RATE_RENDER_COMPUTE_PER_SECOND_USD` — same idea, for Remotion render time.
- `COST_RATE_STORAGE_PER_GB_MONTH_USD` / `COST_RATE_BANDWIDTH_PER_GB_USD` —
  Backblaze B2's current published rates.
- `COST_RATE_STRIPE_PERCENT_FEE` / `COST_RATE_STRIPE_FLAT_FEE_USD` — Stripe's actual
  negotiated rate on this account (check the Stripe dashboard, not the generic
  public rate, if a custom rate was ever negotiated).

## Monthly overhead figures (blocks `MonthlyExpense` rows — `UNIT_ECONOMICS.md`)

No automated way exists to know these — they're genuinely owner-known numbers:
Hetzner server cost, Neon plan cost, Backblaze storage+backup cost, Resend cost,
domain renewal cost, monitoring tool cost, accounting/legal/insurance costs, support
time cost, development time cost, marketing spend, historical refund/chargeback
total, and confirmation of tax registration status.

## Tax / GST treatment

The brief is explicit: **"Do not decide GST treatment in code."** The new pricing
page currently shows a generic, non-committal disclosure ("Prices shown are in USD
and do not include tax, which may apply based on your location"). Confirm with an
accountant:
- Whether Clipforge needs to register for and charge GST/VAT/sales tax in any
  jurisdiction given current revenue and customer locations.
- If so, whether Stripe Tax (or another mechanism) should be enabled, and update the
  pricing-page tax copy to reflect the real, confirmed answer — not before.

## Unpriced video durations

`creditsForStandardVideo()` throws rather than pricing anything over 90 seconds. Is
that an intentional product boundary (short-form only, matching the whole "AI
short-form video" positioning), or should longer standard videos be priced? If the
latter, the specific credit cost for each additional length band is an owner
decision, not something to extrapolate from the existing 10/15/25 pattern.

## Voice-cloning surcharge floor

The brief specifies "+30 credits" as an **"at least"** floor, not a fixed price.
Once real `COST_RATE_VOICE_CLONE_COMPUTE_PER_SECOND_USD` data exists and shows
whether 30 credits' worth of plan revenue actually covers real compute cost,
confirm whether 30 remains correct or needs raising.

## 5,000-credit pack eligibility

The brief restricts this pack to "approved Business/Enterprise accounts" — Stripe
has no native concept of per-customer price eligibility. This needs an actual
approval mechanism (a flag on the account, a manual admin action, something) before
this pack can be safely offered; right now the Stripe *price* exists in test mode,
but nothing in the app enforces the "approved" qualifier. Decide what "approved"
means operationally.

## Existing free-tier accounts (12 real accounts today)

Per `CUSTOMER_MIGRATION.md`: the new Free plan (20 one-time credits) is a real
reduction from what these 12 accounts have today (50 recurring credits, the current
`User.credits` default). Decide:
- Do these 12 accounts stay on their current terms indefinitely (recommended by
  default — "do not unexpectedly change existing customers")?
- Or should they be offered an opt-in path to the new structure, and on what terms?
- Fill in the two blanks in `CUSTOMER_MIGRATION.md`'s draft notice once you know.

## Production Stripe (do NOT do this without reading `PRICING_DEPLOYMENT_CHECKLIST.md` stage 5 first)

Nothing in this pass touched Stripe live mode. When ready to actually launch new
plans:
1. Review `STRIPE_PRODUCT_MAPPING.md`'s test-mode mapping and approve it (or request
   changes).
2. Explicitly separately approve creating the equivalent **live-mode** products —
   this has real billing consequences the moment it exists and should be its own
   deliberate decision, not implied by approving the test-mode mapping.
3. Only then does flipping `PRICING_V2_ENABLED` in production become safe.

## Competitor pricing re-verification

`CompetitorBenchmark` rows for OpusClip/Revid/Klap are dated today
(`lib/pricing/competitors.ts`) and will silently stop appearing in any comparison
after 30 days (by design — the brief requires this). Vizard was never seeded at all
("verify its dynamic pricing before comparison" — no number exists to check yet). If
ongoing competitor comparison matters for the launch, someone needs to periodically
re-verify these against the real pricing pages and re-run `seedCompetitorBenchmarks()`.

## The engineering work still ahead (not owner decisions, but should be sequenced with the above)

Listed in full in `PRICING_DEPLOYMENT_CHECKLIST.md` stages 1, 2, and 5 — wiring cost
tracking into the three job runners, cutting a runner over to the new ledger, and
building v2 checkout. Flagging here only so it's visible in one place: these are
real, non-trivial follow-up passes, not something this session compressed in by
implication.
