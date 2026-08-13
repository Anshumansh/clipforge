# Clipforge Repository Audit Report

**Date:** 2026-08-12  
**Scope:** Phase 1, Phase 2, Phase 2.1 changes  
**Focus:** Credit/idempotency correctness, concurrency/race conditions, Stripe/payment risks, workspace billing, refund/capture exact-once behavior, security regressions

---

## 1. P0 CRITICAL ISSUES

### 1.1 In-Memory Job Queue Loses Jobs on Deploy/Crash
**File:** `lib/jobs/queue.ts:16-20, 36-87`  
The queue is purely in-memory (`pending` array + `active` counter). Any deploy or crash:
- Orphans all jobs in "queued"/"processing" state
- `reconcileOrphanedJobs()` runs only at process start, **not** after a crash mid-render
- Jobs picked up but not yet marked "done" have no persistence → **silent credit loss** if the reservation was captured but job crashes before `captureReservation()` runs
- The comment at line 15 explicitly warns: "Move to a real queue (BullMQ + Redis) before scaling out"

### 1.2 Stripe Webhook: No Grace Period for `invoice.payment_failed` Before Downgrade
**File:** `app/api/stripe/webhook/route.ts:132-141`  
- `invoice.payment_failed` only sets `billingIssue: "past_due"` — **plan/credits unchanged**
- Downgrade to free ONLY happens on `customer.subscription.deleted`
- Stripe retries failed payments for **~23 days** (default dunning) before cancelling
- During this window, user keeps **full paid plan credits/access** despite non-payment
- If user churns during dunning, they consumed paid credits they never paid for

### 1.3 `grantCredits` Uses Random UUID for Idempotency Key
**File:** `app/api/admin/grant-credits/route.ts:42`  
```typescript
idempotencyKey: `admin-grant:${crypto.randomUUID()}`
```
- **Every admin grant call creates a new key** — no idempotency at all
- A double-click / retry / network replay **grants credits twice**
- Admin actions **must** use a caller-supplied idempotency key (like the Stripe webhook does with `event.id`)

### 1.4 Workspace Member Can Be Charged to Wrong Owner on Race
**File:** `lib/workspace.ts:54-61`  
`resolveProjectCreditOwnerId` reads `project.workspaceId` then queries `Workspace.ownerId`. If:
1. Member creates project (workspaceId set)
2. Owner deletes workspace (CASCADE deletes Workspace, SET NULL on Project.workspaceId)
3. Job fails → `resolveProjectCreditOwnerId` returns `project.userId` (member)
4. Refund goes to **member**, not owner — **owner's credits never returned**

---

## 2. P1 SERIOUS ISSUES

### 2.1 Legacy `chargeCredits`/`refundCredits` Still Used by All Live Runners
**Files:** `lib/credits.ts:12-28`, `lib/jobs/*-runner.ts`  
- New `reserveCredits`/`captureReservation`/`releaseReservation` in `lib/pricing/ledger.ts` **never called** by current job runners
- Job runners (`script-runner.ts`, `repurpose-runner.ts`, `ugc-runner.ts`) use legacy flat `CREDITS_PER_VIDEO = 10` charge
- No variable pricing per `credit-calculator.ts` (duration bands, surcharges)
- New pricing engine behind `PRICING_V2_ENABLED` flag but **no migration path** for existing users

### 2.2 Repurpose Charges Flat `CREDITS_PER_VIDEO` Instead of Variable Cost
**File:** `lib/jobs/repurpose-runner.ts:185`  
```typescript
creditsCharged: CREDITS_PER_VIDEO  // 10 credits flat
```
- `credit-calculator.ts` defines: source credits (2/min) + per-clip (10/clip)
- Runner charges **flat 10** regardless of source length or clip count
- Undercovers for long sources; overcharges for short sources with few clips

### 2.3 No Idempotency on `checkout.session.completed` Subscription Grant
**File:** `app/api/stripe/webhook/route.ts:80-91`  
```typescript
idempotencyKey: `stripe:initial-grant:${event.id}`
```
- Correctly uses Stripe event ID — **BUT** `checkout.session.completed` fires **before** `invoice.paid` for the first cycle
- If user signs up → `checkout.session.completed` grants credits → payment fails → `invoice.payment_failed` → eventual `customer.subscription.deleted` downgrades to free
- User got **free credits for a failed payment**
- Should gate initial grant on `invoice.paid` (first successful payment), not checkout completion

### 2.4 `customer.subscription.updated` Grants on Price Change Without Verification
**File:** `app/api/stripe/webhook/route.ts:180-218`  
- `customer.subscription.updated` fires for **any** subscription change (quantity, metadata, trial, discount)
- Grants credit diff on **price ID change only** — correct logic
- **But**: no check that `status === "active"` — a subscription in `past_due` or `canceled` changing price could trigger grant
- Also: no check for `cancel_at_period_end=true` — downgrade scheduled but not yet effective could grant upgrade credits prematurely

### 2.5 Workspace Invite Accepts Existing User Into Multiple Workspaces (Race)
**File:** `app/api/workspace/invite/route.ts:44-57`  
- **Correctly blocks** user who already owns or belongs to a workspace
- **BUT**: Race condition — two concurrent invites to same email could both pass checks before either creates `WorkspaceMember`
- Unique constraint on `WorkspaceMember.userId` (schema.prisma:135) catches it, but error handling returns 500, not 400

### 2.6 Demo Route Uses Separate `demoUserId` That Bypasses Credit System
**File:** `app/api/demo/generate/route.ts:39-63`  
- Creates projects under a shared `demoUserId` — **no credit charge ever**
- No reservation, no ledger entry, no cost tracking
- If demo user runs 3/day (rate limit), that's 3 free renders on shared account
- `reconcileOrphanedJobs()` will fail these with legacy `refundCredits` but demo user has no real credits

### 2.7 Admin Comp Plan Revert Cron Has No Idempotency
**File:** `app/api/cron/revert-expired-comps/route.ts:22-35`  
```typescript
for (const user of expired) {
  const lastComp = await db.adminAction.findFirst(...);
  const revertTo = lastComp?.previousPlan ?? "free";
  await db.user.update({ where: { id: user.id }, data: { plan: revertTo, compPlanExpiresAt: null } });
}
```
- If cron runs twice (e.g., overlapping executions), **second run re-reverts** already-reverted users
- `compPlanExpiresAt` cleared on first run — second run finds no expired comps, but if it races...
- Should use a `processedAt` timestamp or idempotency key per user

---

## 3. P2 IMPROVEMENTS

### 3.1 Idempotency Key for `grantCredits` Should Be Caller-Supplied
**File:** `lib/pricing/ledger.ts:190-224`  
- Current: `grantCredits` checks `CreditLedgerEntry.idempotencyKey` unique constraint
- Caller must pass stable key (e.g., `stripe:upgrade:${event.id}`, `admin-action:${actionId}`)
- `admin-grant` route generates random UUID — **fix required**

### 3.2 Add `status === "active"` Check to `customer.subscription.updated` Handler
**File:** `app/api/stripe/webhook/route.ts:186`  
```typescript
if (user && subscription.status === "active" && newPlan && newPlan.id !== user.plan) { ... }
```
- Prevents grants on past_due/canceled/trialing subscriptions

### 3.3 Initial Credit Grant Should Be on `invoice.paid`, Not `checkout.session.completed`
**File:** `app/api/stripe/webhook/route.ts:52-94`  
- Move grant logic to `invoice.paid` with `billing_reason === "subscription_create"`
- Ensures user only gets credits after **successful first payment**

### 3.4 `resolveProjectCreditOwnerId` Should Use Workspace Snapshot at Charge Time
**File:** `lib/workspace.ts:54-61`  
- Project already stores `workspaceId` at creation
- Current: re-queries Workspace.ownerId at refund time (vulnerable to workspace deletion)
- Fix: Store `creditOwnerId` on Project at charge time (or use existing `workspaceId` + snapshot ownerId in reservation)

### 3.5 Repurpose Runner Should Use Variable Credit Cost
**File:** `lib/jobs/repurpose-runner.ts:179-186`  
- Use `creditsForRepurposeSource(durationSec/60)` for source charge
- Use `creditsForRepurposeClips(completed)` per clip on completion
- Requires per-clip reservation pattern (ledger supports this)

### 3.6 Add `completedAt` to `JobCostRecord`
**File:** `prisma/schema.prisma:642-675`  
- Currently only `createdAt` / `updatedAt`
- Useful for unit economics cohort analysis

### 3.7 Kill Switch Check Missing from Generation Routes
**Files:** `lib/pricing/flags.ts:22-36`, `app/api/projects/*/route.ts`  
- `isFeatureAllowed("repurpose")` / `isFeatureAllowed("voice_clone")` never called in routes
- Kill switch only useful if **actually checked** at feature entry points

---

## 4. PASS — CORRECTLY IMPLEMENTED

| Area | File(s) | Notes |
|------|---------|-------|
| **Credit reservation idempotency** | `lib/pricing/ledger.ts:66-118` | `idempotencyKey` unique on `CreditReservation`; race handled via P2002 catch |
| **Exact-once capture/release** | `lib/pricing/ledger.ts:133-184` | Status checks (`reserved` only) prevent double-capture/double-release |
| **Ledger audit trail** | `lib/pricing/ledger.ts:92-103, 171-182` | Every credit movement writes `CreditLedgerEntry` with `balanceAfter` |
| **Stripe webhook dedup** | `app/api/stripe/webhook/route.ts:40-49` | `StripeWebhookEvent.id = event.id` (PK) prevents replay |
| **Upgrade credit diff (not full)** | `app/api/stripe/webhook/route.ts:201-203` | `Math.max(0, newPlan.monthlyCredits - oldPlan.monthlyCredits)` |
| **Workspace member spends owner's credits** | `lib/workspace.ts:39-47, 77-84` | `resolveGenerationContext` correctly uses `owner.plan` for member |
| **Project access filter (IDOR prevention)** | `lib/workspace.ts:86-95, lib/workspace.test.ts:127-150` | Member sees only own workspace's projects; workspaceId from DB, not user input |
| **Admin action audit log** | `app/api/admin/grant-credits/route.ts:33-35, app/api/admin/comp-plan/route.ts:44-54` | Every credit/plan change logged with admin, target, before/after |
| **Comp plan revert uses original plan** | `app/api/admin/comp-plan/route.ts:31-38, app/api/cron/revert-expired-comps/route.ts:24-28` | Snapshots `previousPlan` from last `plan_comp` action |
| **Orphaned job reconciliation + refund** | `lib/jobs/queue.ts:36-87` | Finds stuck jobs, fails them, releases reservations (exact-once) or legacy refunds |
| **Client operation id idempotency** | `lib/pricing/generation-idempotency.ts:34-124` | Keys on `gen:type:requestingUserId:clientOperationId` — NOT content hash |
| **Reservation amount refunded exactly** | `lib/pricing/ledger.ts:159-162` | `reservation.amount` used, not hardcoded constant |
| **Plan versioning (immutable snapshots)** | `prisma/schema.prisma:748-763, lib/pricing/plan-config.ts` | `PlanVersion` with `effectiveFrom/Until`; existing users pinned to their version |
| **Credit calculator throws on unpriced** | `lib/pricing/credit-calculator.ts:18-35` | `UnpricedDurationError` >90s instead of guessing |

---

## 5. SPECIFIC FILES/FUNCTIONS INVOLVED

| Issue | Files |
|-------|-------|
| In-memory queue loss | `lib/jobs/queue.ts:16-20, 36-87` |
| Stripe dunning gap | `app/api/stripe/webhook/route.ts:132-141, 52-94` |
| Admin grant idempotency | `app/api/admin/grant-credits/route.ts:42, lib/pricing/ledger.ts:190-224` |
| Workspace refund race | `lib/workspace.ts:54-61, lib/jobs/*-runner.ts:141-150` |
| Legacy flat charging | `lib/credits.ts:12-28, lib/jobs/*-runner.ts:129-130, 179-186` |
| Repurpose variable cost | `lib/pricing/credit-calculator.ts:55-63, lib/jobs/repurpose-runner.ts:179-186` |
| Initial grant on checkout | `app/api/stripe/webhook/route.ts:52-94` |
| Subscription updated guards | `app/api/stripe/webhook/route.ts:180-218` |
| Workspace invite race | `app/api/workspace/invite/route.ts:44-57` |
| Cron revert idempotency | `app/api/cron/revert-expired-comps/route.ts:22-35` |
| Kill switch unused | `lib/pricing/flags.ts:24-36, app/api/projects/*/route.ts` |
| Demo bypass | `app/api/demo/generate/route.ts:39-63` |

---

## Summary

**The new credit/ledger/reservation system (`lib/pricing/ledger.ts`, `generation-idempotency.ts`) is well-designed and correctly implements exact-once semantics, idempotency keys, and audit trails.**

**However, it is NOT YET USED by any live generation path** — all three job runners still use the legacy flat `CREDITS_PER_VIDEO = 10` charge via `lib/credits.ts`. The pricing v2 flag is off, and there's no migration strategy.

**Critical production risks:**
1. In-memory queue loses jobs on deploy/crash
2. Stripe dunning allows free paid-tier usage during payment failure
3. Admin credit grants have **zero idempotency**
4. Workspace refund race on workspace deletion

**Recommended immediate fixes:**
1. Add `status === "active"` guard to subscription.updated
2. Move initial grant to `invoice.paid`
3. Fix admin grant idempotency key
4. Snapshot creditOwnerId at charge time
5. Plan BullMQ migration