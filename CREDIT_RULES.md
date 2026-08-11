# Credit Rules — Pricing Overhaul

Governs how credits are earned, spent, held, and refunded. Section 8 of the brief.
The mechanism described here (`lib/pricing/ledger.ts`) exists and is tested; it is
not yet the code path any live route actually calls (see "Current status" at the
bottom).

## Lifecycle: reserve → capture or release

Every charge is a **reservation**, not a direct decrement, even though the balance
effect is identical (credits leave the balance the moment a reservation is created —
a user can never overspend while a job is in flight, enforced by the same
`WHERE credits >= amount` atomic guard the legacy system already uses). What's new is
that the reservation is a durable row with its own status:

- **reserved** — credits are held. The job is running.
- **captured** — the job succeeded. The hold is permanent. No balance change (the
  decrement already happened at reserve time).
- **released** — the job failed, was never actually enqueued, or was cancelled
  before starting. The reservation's *exact* held amount is credited back — never a
  hardcoded constant. This is a fix for a real bug the audit found: the legacy
  `refundCredits(userId, CREDITS_PER_VIDEO)` always refunds a flat 10, which would
  under-refund a variable-cost job (e.g. a failed 110-credit repurpose job) the
  moment variable pricing goes live.

Both `captureReservation` and `releaseReservation` are **exact-once**: calling
either on an already-resolved reservation is a silent no-op, not an error and not a
second balance change. A job cannot be refunded twice, and a captured job cannot
later be refunded by a stray retry.

## Idempotency

Every credit-affecting call (`reserveCredits`, `grantCredits`) takes an
`idempotencyKey`. A duplicate call with the same key — a network retry, a doubled
webhook delivery — returns the original result without charging or granting again.
Concurrent duplicate calls (two requests racing on the same key) are resolved by
letting the database's unique constraint pick a winner and having the loser re-query
and return the winner's result, rather than erroring or double-charging.

## The immutable ledger

Every reservation, capture, release, and grant appends a `CreditLedgerEntry` — signed
delta, resulting balance, and a note. Nothing is ever updated or deleted; a
correction is a new offsetting entry. `User.credits` stays the fast-read running
total (unchanged, still what every route checks); the ledger exists so "why does this
account have exactly this many credits" always has a real, queryable answer.

## Specific rules from the brief, and how each is implemented

- **Negative balances**: prevented by the same atomic `WHERE credits >= amount`
  guard used today — `reserveCredits` throws `InsufficientCreditsError` rather than
  letting the balance go negative.
- **Concurrent double spending**: the atomic guard plus the reservation's unique
  `idempotencyKey` together mean two simultaneous requests for the same logical
  charge cannot both succeed.
- **Duplicate webhook grants**: `StripeWebhookEvent` is keyed on the Stripe event id
  itself — a replayed delivery's insert fails the unique constraint before any
  handler logic (including a credit grant) re-runs. Shipped and live in production
  today (`app/api/stripe/webhook/route.ts`), independent of the rest of this
  overhaul.
- **Duplicate retry charges**: covered by `idempotencyKey` on `reserveCredits` — a
  retried request for the same job reuses the same key and gets the same
  reservation back, never a second charge.
- **Cross-workspace usage**: `CreditReservation`/`CreditLedgerEntry` both carry an
  optional `workspaceId`, so a member spending from a workspace owner's pool is
  attributed correctly rather than silently merged into the member's own history.
  (Enforcement of *which* pool a given request should draw from is the existing
  `lib/workspace.ts` logic, unchanged by this pass.)
- **Refund abuse**: a refund only ever happens via `releaseReservation`, which reads
  the amount from a reservation record that was itself created by a real charge —
  there's no code path that lets a refund amount be supplied arbitrarily by a
  caller.
- **System-failed render → automatic full refund**: `releaseReservation`'s default
  note is literally "System-failed render, automatic full refund" — a job runner's
  catch block calling this on failure gets the correct behavior by default.
- **Full customer-requested re-render → normal cost**: not a special code path —
  calling the calculator again for the same inputs and reserving that amount *is*
  the correct behavior. There's no "free re-render" mechanism anywhere in this
  system, deliberately.
- **Duplicate/retried system job → never charge twice**: the same `idempotencyKey`
  mechanism — a system-level retry (not a user-initiated one) should derive its key
  from the job id, not generate a fresh one, so a retried attempt is recognized as
  the same logical charge.

## Current status

Everything above is implemented and tested in isolation (`lib/pricing/ledger.test.ts`
— reservation creation, insufficient-balance rejection, idempotent replay,
concurrent-race resolution, exact-once capture/release, exact-amount refund,
idempotent grants). **No live job runner or API route calls any of it yet** — every
runner still calls the legacy `lib/credits.ts` `chargeCredits`/`refundCredits`
exactly as before. Cutting a runner over to the new ledger is real, reviewable,
per-runner work, gated behind `PRICING_V2_ENABLED`, and explicitly not attempted in
this pass.
