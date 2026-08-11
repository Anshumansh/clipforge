# Unit Economics — Pricing Overhaul

**No claim in this document should be read as "Clipforge is profitable."** Per the
brief's own closing instruction, that claim requires production cost and
customer-usage data this system has not collected yet. What follows is the
*machinery* for computing real margins once that data exists, plus the honest
current state: mostly no data yet.

## The formulas (brief section 7, implemented verbatim in `lib/pricing/margin.ts`)

**Contribution margin** = (net revenue − AI cost − transcription cost − TTS cost −
rendering cost − storage/egress cost − Stripe fees − refunds/chargebacks − other
direct costs) ÷ net revenue.

**Maximum safe variable cost per credit** = net plan revenue × 30% ÷ included
credits. Example: Starter ($15/mo, 250 credits) → max safe cost per credit =
$15 × 0.3 ÷ 250 = **$0.018**. If a Starter account's real average cost per credit
consumed ever exceeds that, the plan is not on track for the 70% margin target at
full legitimate usage.

**Alert thresholds**, all implemented in `lib/pricing/margin.ts` and enforced
against real numbers once they exist:
- Plan margin < 70% → warning
- Plan margin < 50% → critical
- A single job's cost > its allocated revenue → job-loss alert
- Retry cost > 10% of production cost → retry-rate alert
- One customer's cost > 30% of their net subscription revenue → customer-cost alert
- Daily provider/demo spend reaches its configured cap → spend-cap alert

## What data exists today

**Nothing yet.** `JobCostRecord` (the per-generation cost table — AI tokens,
transcription seconds, TTS characters, render seconds, storage/bandwidth bytes) is
built (`lib/pricing/cost-tracking.ts`'s `recordJobUsage()`) but is not called from
any of the three live job runners (`lib/jobs/script-runner.ts`,
`repurpose-runner.ts`, `ugc-runner.ts`). Wiring that in is the literal next step —
deliberately not done in this pass so each runner's actual provider-response shape
(what OpenAI/Groq/the TTS provider/the render pipeline actually return) can be
checked against real calls rather than guessed at here.

## What rates exist today

**None.** `lib/pricing/cost-rates.ts`'s `getCostRates()` reads every per-unit rate
(AI $/1k tokens, transcription $/minute, TTS $/character, voice-clone and render
compute $/second, storage $/GB-month, bandwidth $/GB, Stripe's percentage + flat
fee) from environment variables that are **all unset**. This is deliberate, not an
oversight — the brief says "do not invent costs," and a stale or wrong memorized
rate is exactly as invented as a made-up one. See `OWNER_ACTIONS_REQUIRED.md` for
the specific rates needed and where to get them.

Until rates are supplied, every `*CostUsd` field on every `JobCostRecord` stays
`null` — code throughout this pass (`totalKnownCostUsd`, the margin functions)
treats `null` as "unknown," never silently coerces it to `0`. A job with unknown
cost should never appear as a "free" job in any report.

## Monthly overhead

Tracked via the `MonthlyExpense` table (category + amount, `isEstimate: true` by
default) — Hetzner, Neon, Backblaze, OpenAI, Groq, Stripe fees, Resend, domain,
monitoring, accounting, legal, insurance, support, development, marketing, refunds/
chargebacks, tax. No rows exist yet; nothing populates them automatically, since
these are genuinely owner-known numbers (an invoice, a subscription cost), not
something derivable from application behavior. See `OWNER_ACTIONS_REQUIRED.md`.

## Current subscriber base (real, not estimated — see `CUSTOMER_MIGRATION.md`)

12 total accounts, all Free tier, **zero active paid Stripe subscriptions.** There is
no existing paid-plan margin to report on, positive or negative, because there is no
existing paid-plan revenue.

## What this means practically

The pricing/credit *engine* built in this overhaul (calculator, ledger, cost
tracking, margin math, kill switches) is complete and tested as pure logic. What it
cannot yet tell you is whether $15/mo actually covers a Starter customer's real AI +
render + storage cost at full usage — that requires the rates and the wiring above,
which requires an owner decision (rates) and a follow-up engineering pass (wiring),
in that order.
