# Stripe Product Mapping — Pricing Overhaul (2026-08-v1)

Status: **TEST MODE ONLY**. Nothing below exists in Stripe live mode. No production
Stripe product, price, or webhook config has been created or modified by this work.

## How these were created

Provisioned once via a script run locally against the existing Stripe **test-mode**
secret key already present in `.env` (`sk_test_...` — a separate credential from the
live key configured on the production VPS; this local key has never had production
access). The script is idempotent (looks up by product metadata before creating), so
re-running it after a `PLAN_CONFIGS` edit updates prices rather than duplicating
products. It is not committed to the repo (one-time provisioning, not app code) — its
logic is reproducible from `lib/pricing/plan-config.ts`'s `PLAN_CONFIGS` if it needs to
be run again or adapted for live mode.

## Plan subscription products (monthly + annual price each)

| Plan | Product ID | Monthly price | Monthly USD | Annual price | Annual USD |
|---|---|---|---|---|---|
| Starter | `prod_V3Gw3EyTJ9N65v` | `price_1U3AOIEEzfEyIW8T7S1LWM0S` | $15 | `price_1U3AOIEEzfEyIW8TP8dIpWAS` | $144 |
| Creator | `prod_V3GwYzg5P3thJk` | `price_1U3AOJEEzfEyIW8TE3uTRY2n` | $29 | `price_1U3AOJEEzfEyIW8TQI9D3Ogz` | $278 |
| Pro | `prod_V3GwdgST2iSXIT` | `price_1U3AOLEEzfEyIW8TdBAxoXK5` | $59 | `price_1U3AOLEEzfEyIW8TWD5Fyeff` | $566 |
| Business | `prod_V3GwAjIpurOTBX` | `price_1U3AOMEEzfEyIW8TBNv7ZL8L` | $119 | `price_1U3AONEEzfEyIW8T4jK9uDSD` | $1,142 |

Free has no Stripe product (no billing relationship until a user upgrades).

## Credit packs (one-time purchase, not subscriptions)

| Pack | Product ID | Price ID | Credits | USD |
|---|---|---|---|---|
| Small | `prod_V3GwzNAVwrPqXT` | `price_1U3AOOEEzfEyIW8TSE5a2Jo4` | 100 | $9 |
| Medium | `prod_V3GwXm3YJBw4w3` | `price_1U3AOPEEzfEyIW8Tk92XjgdF` | 500 | $39 |
| Large | `prod_V3GwdxW65yic6O` | `price_1U3AOQEEzfEyIW8Tk9qTx6OG` | 1,500 | $99 |
| Business/Enterprise-approved | `prod_V3Gwxp3Q2dUq30` | `price_1U3AOSEEzfEyIW8TEG6ozc9N` | 5,000 | $279 |

The 5,000-credit pack's Stripe price has no built-in per-customer eligibility check —
Stripe doesn't model "approved accounts only." Enforcement is application-level: the
checkout route must reject this pack unless the purchasing account is Business/
Enterprise **and** has been explicitly approved (a flag/allowlist that doesn't exist
yet — tracked in OWNER_ACTIONS_REQUIRED.md, since "approved" implies a real approval
process, not just a plan check).

## Seat add-on (recurring, attached to a Pro/Business subscription)

| Product ID | Price ID | USD/seat/month |
|---|---|---|
| `prod_V3GwiOg06q3fYQ` | `price_1U3AOTEEzfEyIW8Tj7Iv9Eje` | $8 |

Not yet wired to checkout — billed as an additional subscription item on the same
Stripe subscription, once the checkout/upgrade flow supports adding seats
(`User.seats` field exists in the schema; the Stripe-side wiring is still open).

## Where these live in code

`.env` (test mode values, gitignored, never committed):
```
STRIPE_PRICE_V2_STARTER_MONTHLY / STRIPE_PRICE_V2_STARTER_ANNUAL
STRIPE_PRICE_V2_CREATOR_MONTHLY / STRIPE_PRICE_V2_CREATOR_ANNUAL
STRIPE_PRICE_V2_PRO_MONTHLY / STRIPE_PRICE_V2_PRO_ANNUAL
STRIPE_PRICE_V2_BUSINESS_MONTHLY / STRIPE_PRICE_V2_BUSINESS_ANNUAL
STRIPE_PRICE_V2_CREDIT_PACK_100 / _500 / _1500 / _5000
STRIPE_PRICE_V2_SEAT_ADDON
```

Read via `lib/pricing/stripe-mapping.ts` (`getV2PriceId`, `getV2PlanByPriceId`,
`getCreditPackPriceId`, `getCreditPackByPriceId`, `getSeatAddonPriceId`) — never
hardcoded in application code, same pattern as the existing legacy
`STRIPE_PRICE_CREATOR`/`STRIPE_PRICE_BUSINESS` vars in `lib/plans.ts`.

## Webhook idempotency (shipped, live in production now)

`app/api/stripe/webhook/route.ts` now inserts a `StripeWebhookEvent` row keyed on the
Stripe event id itself as the very first step after signature verification, before any
event-type handler runs. A retried delivery (Stripe retries on any non-2xx or timeout)
hits the row's unique constraint and returns `{ received: true, duplicate: true }`
without re-running handler logic. This is a pure safety addition — every existing event
type continues to be handled exactly as before for a genuinely new event; the only
behavior change is that duplicates are now provably no-ops instead of being
"accidentally safe" only because most handlers happen to use absolute `set` semantics
rather than `increment`. Covered by `app/api/stripe/webhook/route.test.ts`.

This part is **not** test-mode-only — it's a real production hardening fix, already
merged and deployed, independent of whether the new plans ever go live.

## What is NOT done yet (do not treat as complete)

- **Checkout route** (`app/api/stripe/checkout/route.ts`) still only knows the legacy
  `hobby`/`creator`/`business` plans (`lib/plans.ts`). It does not yet accept a
  `planVersionId`, a billing interval (monthly/annual), a credit pack, or a seat add-on.
  Wiring that in is the next step, gated behind `PRICING_V2_ENABLED`.
- **Webhook handler** does not yet grant credits via `lib/pricing/ledger.ts`'s
  `grantCredits()` (idempotent, ledger-recorded) for the new plans — it still uses the
  legacy direct `db.user.update` for the old plan IDs only. New-plan checkout/renewal
  events aren't handled at all yet since no such checkout path exists.
- **Reconciliation** (`lib/stripe-reconciliation.ts`) does not yet know about the new
  plan price IDs — it will report every v2 subscriber as a mismatch until updated.
- **Live-mode products do not exist.** Creating them is explicitly gated on owner
  approval per the brief (section 9, section 13 stage 3→4) — this document is the
  artifact that approval decision is made against.
