# Pricing Deployment Checklist

Maps directly to the brief's own staged-rollout requirement (section 13): **"Do not
make one uncontrolled production deployment."** Each stage below is a real go/no-go
gate, not a formality — do not skip ahead because a later stage looks easy.

## Stage 1 — Cost measurement without changing prices ⏳ Partially done

- [x] `JobCostRecord` schema exists.
- [x] `recordJobUsage()` (usage capture) and cost-rate reading (`getCostRates()`)
      exist and are tested.
- [ ] **Not done**: wiring `recordJobUsage()` into the three live job runners
      (script/repurpose/ugc) so real usage data actually starts accumulating. This
      is the literal next engineering step — see `UNIT_ECONOMICS.md`.
- [ ] **Not done**: owner supplies real cost rates (env vars listed in
      `OWNER_ACTIONS_REQUIRED.md`). Without them, cost fields stay `null` forever
      even once wiring exists.

## Stage 2 — Canonical credit engine, ledger, refunds behind feature flags ✅ Done

- [x] `lib/pricing/credit-calculator.ts` — every cost figure from the brief,
      tested against the brief's own worked example.
- [x] `lib/pricing/ledger.ts` — reserve/capture/release, idempotent, exact-once.
- [x] Gated behind `PRICING_V2_ENABLED` (unset everywhere today — verified false
      in production via the live pricing page still showing the legacy plans).
- [ ] **Not done**: no live job runner calls the new ledger yet. Stage 2 built the
      engine; cutting a runner over to it is separate, deliberately-deferred work.

## Stage 3 — Configure and test new products in Stripe test mode ✅ Done

- [x] Starter/Creator/Pro/Business monthly + annual products created in Stripe
      **test mode** (`STRIPE_PRODUCT_MAPPING.md` has every product/price id).
- [x] Four credit packs + the seat add-on created in test mode.
- [x] Webhook idempotency (`StripeWebhookEvent`) — this one is **already live in
      production**, independent of the rest, since it's a pure safety fix with no
      behavior change for genuinely new events.
- [ ] **Not done**: the checkout route (`app/api/stripe/checkout/route.ts`) does not
      yet accept a v2 plan, billing interval, credit pack, or seat add-on — it only
      knows the legacy hobby/creator/business ids. No real test-mode checkout has
      been run end-to-end yet.

## Stage 4 — Present the Stripe mapping + migration impact for owner approval ✅ Done (this document set)

- [x] `STRIPE_PRODUCT_MAPPING.md` — the exact test-mode mapping, and explicitly
      what's still missing before it could go live.
- [x] `CUSTOMER_MIGRATION.md` — real current-subscriber numbers (12 accounts, 0
      paid), the grandfathering mechanism, a draft notice, and an explicit
      no-action-without-approval gate.
- [ ] **Owner decision pending**: everything past this point requires explicit
      sign-off. Nothing in this pass proceeds past stage 4 on its own.

## Stage 5 — Enable new plans for new customers only ⛔ Not started (owner-gated)

Requires, in order:
1. Owner approval of stage 4's mapping and migration report.
2. Checkout route accepts v2 plans (build work, not started).
3. Real Stripe **live-mode** products created — never done without a separate,
   explicit owner approval distinct from the test-mode approval above (a live
   product creation has real billing consequences from the moment it exists).
4. `PRICING_V2_ENABLED` flipped on in production — a deploy, not a runtime toggle,
   so it's a deliberate, reviewed action.
5. Confirm existing accounts are unaffected (their `planVersionId` stays `null`,
   the legacy pricing page and legacy checkout continue working for them).

## Stage 6 — Monitor real costs and margins for 30 days ⛔ Not started

Depends entirely on stage 1's runner-wiring being live first — there's nothing to
monitor until real `JobCostRecord` data exists.

## Stage 7 — Adjust prices or credit weights based on evidence ⛔ Not started

Depends on stage 6 producing real evidence. Do not pre-emptively adjust anything in
`PLAN_CONFIGS` or `credit-calculator.ts` based on assumption — that's exactly the
"invented cost" problem the brief is designed to prevent.

## Standing verification (repeat before every future pricing-related deploy)

- [ ] `npx tsc --noEmit`
- [ ] `npm test`
- [ ] `npm run build` — and actually run the standalone output
      (`node .next/standalone/server.js`, matching the Dockerfile, not `next dev`
      or bare `next start`) and check the browser console in a **fresh tab**. This
      pass caught two real bugs (`PrismaClient` bundled into client JS; a
      static-prerender-vs-unreachable-CI-database crash) that only surfaced under
      an actual production build — `tsc --noEmit` and unit tests both passed clean
      while these bugs were live.
- [ ] Migration validation: `prisma db push` is additive-only for every model in
      this overhaul today; confirm that's still true before any future schema
      change touching these tables.

## Rollback

Every deploy in this overhaul went through the same staged branch → merge → push →
watch-CI-to-completion process already established for this project (see git log:
`pricing/overhaul-pass1` through `pass5`). Rolling back any single pass is a normal
`git revert` of its merge commit — nothing here used a destructive migration, so
there's no data-loss risk in reverting the code. `PRICING_V2_ENABLED` being unset by
default means an emergency rollback of the *page* is just unsetting that one env var
and restarting the container, no code change needed.
