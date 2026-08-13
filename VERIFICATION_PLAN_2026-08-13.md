# Production Readiness Verification & Remediation Plan

**Date:** 2026-08-13  
**Status:** 🔴 CRITICAL ISSUES — Remediation in progress  
**Do Not Deploy:** Until all sections marked ✅ VERIFIED are complete

---

## PART 1: Test Suite Failures — Root Cause Analysis

### Issue: 18/302 Tests Failing

**Location:** `lib/jobs/claim.test.ts`  
**Commit:** fc8a26c  
**Test Run:** 2026-08-13 10:48 UTC

### Root Cause (VERIFIED)

The function `claimNextQueuedJob()` was modified to return backpressure flags but callers were not updated.

**Implementation Signature (claim.ts:100-104):**
```typescript
export async function claimNextQueuedJob(
  workerId: string,
  userId?: string,
  workspaceId?: string | null
): Promise<{ job: ClaimedJob; shouldThrottle: boolean; shouldDegrade: boolean } | null>
```

**Actual Return (claim.ts:184-188, 114-115, 126-127):**
```typescript
// Success:
return { job: { id, type }, shouldThrottle: false, shouldDegrade: false };

// Throttled:
return { job: null as never, shouldThrottle: true, shouldDegrade: false };

// Degraded:
return { job: null as never, shouldThrottle: false, shouldDegrade: true };

// No job queued:
return null;
```

**Consumer (worker/index.ts:134-145):**
```typescript
let claimed: ClaimedJob | null;  // ← expects old type: { id, type } | null
try {
  claimed = await this.claim();
} catch (err) { ... }
if (!claimed) break;

this.active++;
this.log(`[worker:${this.instanceId}] job claimed id=${claimed.id} type=${claimed.type}`);
```

**Consumer Type Definition (worker/index.ts:52, 95):**
```typescript
claim?: () => Promise<ClaimedJob | null>;  // ← Old type
```

**Test Expectation (claim.test.ts:127):**
```typescript
expect(result).toEqual({ id: "job-1", type });  // ← Old type
```

### Impact Assessment

| Area | Status | Consequence |
|------|--------|-------------|
| **Type signature** | ⚠️ Inconsistent | Return type says `ClaimedJob` (not nullable), but code returns `null as never` |
| **Worker usage** | ⚠️ Broken | Worker still expects old `{ id, type } \| null`, but gets `{ job, shouldThrottle, shouldDegrade } \| null` |
| **Backpressure flags** | ⚠️ Unused | New flags are computed and returned but never read by any caller |
| **Tests** | ❌ Failing | 18 tests expect old return type |
| **API routes** | ✅ Unaffected | `/api/projects/script`, `/api/projects/repurpose`, etc. don't use `claimNextQueuedJob` |

### Root Cause Classification

❌ **Real Implementation Regression** — Not just test mocks that need updating

The backpressure feature was partially implemented:
1. ✅ Flags computed in `claimNextQueuedJob`
2. ❌ But **never used** by the worker (which just expects null)
3. ❌ But **never used** by API routes (which have their own backpressure)
4. ❌ Type signature not fixed to reflect new reality

---

## PART 2: Metrics Endpoint Missing

**Severity:** 🔴 CRITICAL  
**Status:** ❌ NOT IMPLEMENTED

### Evidence

**Filesystem verification:**
```bash
$ find app/api -name "*metrics*" -type f
$ # (No results)

$ ls -la app/api/metrics/
# (Directory does not exist)
```

**What should exist:** `/api/metrics` endpoint exporting Prometheus text format  
**What actually exists:**
- ✅ `/api/health` (readiness probe)
- ✅ `/api/health/live` (liveness probe)
- ❌ `/api/metrics` (does not exist)

### Requirements (From Audit & User Instructions)

**Must implement `/internal/metrics` (not public `/api/metrics`)**

Protected endpoint with:
- ✅ Strong service authentication (bearer token or mutual TLS)
- ✅ No access for ordinary users or anonymous traffic
- ✅ Network-level restriction where infrastructure supports it
- ✅ Rate limiting per authenticated service
- ✅ `Cache-Control: no-store`
- ❌ Never expose: customer IDs, emails, prompts, media paths, tokens, presigned URLs, job IDs
- ✅ Export safe metrics only

**Metrics to Export:**

Core HTTP:
- `http_requests_total` (counter) — by route group, method, status class
- `http_request_duration_seconds` (histogram) — for p95/p99 quantiles

Queue:
- `queue_depth` (gauge) — jobs in "queued" status
- `queue_oldest_job_age_seconds` (gauge) — time since oldest queued job
- `jobs_started_total` (counter) — transitions to "processing"
- `jobs_completed_total` (counter) — transitions to "completed"
- `jobs_failed_total` (counter) — transitions to "failed_*"
- `jobs_retried_total` (counter) — transitions to queued after backoff
- `jobs_dead_lettered_total` (counter) — reached maxAttempts

Worker:
- `worker_lease_loss_total` (counter) — lease expirations detected
- `worker_heartbeat_age_seconds` (gauge) — time since last heartbeat
- `worker_restarts_total` (counter) — process restarts

Credits:
- `credit_reservations_created_total` (counter)
- `credit_reservations_captured_total` (counter)
- `credit_reservations_released_total` (counter)
- `credit_inconsistencies_total` (counter) — balance/reservation mismatches
- `demo_submissions_total` (counter)
- `demo_submissions_accepted_total` (counter)
- `demo_submissions_rejected_total` (counter)

Providers:
- `provider_calls_total` (counter) — by provider, method, status
- `provider_call_duration_seconds` (histogram) — by provider

Database:
- `db_pool_active_connections` (gauge) — if safely available
- `db_pool_idle_connections` (gauge) — if safely available
- `db_pool_waiting_requests` (gauge) — when pool is saturated

### Implementation Plan

**File:** `app/api/internal/metrics/route.ts` (new)

**Structure:**
```typescript
import { auth } from "@/lib/api-auth";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  // 1. Authenticate with strong bearer token or mutual TLS
  const token = req.headers.get("authorization")?.split(" ")[1];
  if (!token || !isValidMetricsToken(token)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Rate limit per service
  const { ok } = rateLimit(`metrics:${token}`, 60, 60 * 1000);
  if (!ok) return new Response("Too Many Requests", { status: 429 });

  // 3. Collect metrics from database
  const metrics = await collectMetrics();

  // 4. Return Prometheus text format
  const text = formatPrometheus(metrics);
  return new Response(text, {
    headers: {
      "Content-Type": "text/plain; version=0.0.4",
      "Cache-Control": "no-store"
    }
  });
}
```

**Security tests required:**
- Unauthenticated requests → 401
- Invalid token → 401
- Rate-limited token → 429
- Authenticated → 200 with Prometheus data
- No customer PII in output
- No high-cardinality fields
- No job IDs (or aggregated only)

---

## PART 3: Monitoring Plan Missing

**Severity:** 🔴 CRITICAL  
**Status:** ❌ NOT CREATED

### Required File

**Path:** `MONITORING_PLAN.md` (new)  
**Contents:**

1. **Architecture Overview**
   - Prometheus scrape configuration
   - Grafana provisioning
   - Storage retention (30 days?)
   - Cost options (self-hosted vs. SaaS)

2. **Metrics Endpoint Authentication**
   - Bearer token format
   - Token rotation procedure
   - Mutual TLS configuration (if applicable)

3. **Prometheus Configuration**
   ```yaml
   scrape_configs:
     - job_name: 'clipforge'
       static_configs:
         - targets: ['https://api.example.com/internal/metrics']
       headers:
         Authorization: 'Bearer ${METRICS_TOKEN}'
       scrape_interval: 30s
       scrape_timeout: 10s
   ```

4. **Grafana Dashboard Panels**
   - Queue health: depth, oldest age, throughput
   - Worker status: heartbeat, restart count, lease losses
   - Credit safety: inconsistencies, demo cost
   - Errors: 5xx rate, provider failures, database warnings
   - Performance: p95/p99 latency by route group

5. **Alert Thresholds & Runbooks**

   | Alert | Threshold | Runbook |
   |-------|-----------|---------|
   | Application Unavailable | `/api/health` → 503 | Check Prometheus scrape logs; restart if crashed |
   | Queue Depth Excessive | `queue_depth > 500` for 5m | Check if workers healthy; scale if needed |
   | Worker Heartbeat Missing | `worker_heartbeat_age_seconds > 60` | SSH to worker; check logs; restart if necessary |
   | Lease Loss Spike | `worker_lease_loss_total` rate > 0.1/sec | Worker hanging or OOM; check memory; increase timeout if needed |
   | Dead-Letter Job Created | `jobs_dead_lettered_total > 0` | Page on-call; investigate cause; may need manual job repair |
   | Credit Inconsistency | `credit_inconsistencies_total > 0` | Page on-call; query DB for mismatches; audit ledger |
   | Demo Cost Ceiling | `demo_submissions_accepted_total` suggests $50+/day cost | Reduce `DEMO_GLOBAL_LIMIT_PER_DAY`; or budget increase |
   | Error Rate Spike | HTTP 5xx rate > 1% | Check logs; check provider APIs; check database |
   | P95 Latency High | `http_request_duration_seconds{quantile="0.95"} > 1.0` | Check query logs; identify slow queries; scale if needed |
   | Database Pool Waiters | `db_pool_waiting_requests > 0` sustained | Increase pool size; reduce transaction duration; optimize queries |
   | Backup Failure | Restore-test fails or doesn't run | Restore from backup manually; investigate cause; fix backup script |

6. **On-Call Responsibilities**
   - Check `/internal/metrics` every 5 minutes (first 1 hour)
   - Every 15 minutes for next 5 hours
   - Escalate if any alert fires
   - Document incident in Slack channel

7. **Data Retention**
   - Prometheus: 30 days (disk space constraint?)
   - Grafana snapshots: indefinite (archive for postmortems)
   - Alert logs: indefinite

8. **Incident Severity Levels**
   - **P0 (Page Immediately):** Application down, worker dead, credit lost
   - **P1 (Page Within 15m):** Queue backing up, errors spiking, performance degraded
   - **P2 (Address Soon):** Minor issues, no user impact yet
   - **P3 (Backlog):** Documentation, optimization, future planning

---

## PART 4: Database Connection Pool Analysis

**Current State (From LOAD_TEST_RESULTS.md):**
```
DB connections: 44/50 (88%)
```

**User Instruction:** "Reject the unsupported instruction to set `connection_limit=75`"

### Analysis Required (Before Any Change)

1. **Neon Plan Connection Limit**
   - What is the maximum connections allowed by the current Neon plan?
   - Document in `.env` comment or config validation

2. **Connection Pool Architecture**
   - PgBouncer mode (transaction vs. session)
   - Pooled vs. direct hostname
   - Are connections to the pooled endpoint or direct?

3. **Application Replicas**
   - How many Next.js instances?
   - How many worker instances?
   - How many total application processes?

4. **Measurements During Load Test**
   - Peak active connections: 44
   - Peak idle connections: ?
   - Peak waiting requests: ?
   - Database query latency: ?
   - Transaction duration: ?

5. **Current Behavior**
   - Do requests time out waiting for a connection?
   - Do requests fail with 503 when pool exhausted?
   - What's the acceptable latency penalty?

### Calculation Formula

```
Safe pool per process = floor(
  (Neon plan limit - operational reserve) / 
  (max concurrent app replicas + max concurrent worker replicas)
)
```

Where operational reserve = 5-10 connections for:
- Migrations
- Admin queries
- Monitoring
- Backups

### Recommendation (Pending Measurements)

**Do not change `connection_limit` until:**
- [ ] Measure peak active connections under real production load
- [ ] Measure connection wait time percentiles
- [ ] Measure database query latency (p50/p95/p99)
- [ ] Profile slow queries with `pg_stat_statements`
- [ ] Verify transaction discipline (no long-running open txns)
- [ ] Document why current pool is insufficient (if it is)
- [ ] Run load test at several pool sizes and compare results
- [ ] Get owner approval for any changes

**Likely outcome:** Pool size stays at 5-10 per process, total 10-20 per environment, far below 75.

---

## PART 5: Worker Safety Guardrails

**Current State:** No runtime check prevents multiple workers from running  
**Instruction:** Implement temporary single-worker cap safely (not permanent prohibition)

### Implementation (Safe Approach)

**File:** `worker/index.ts` (new startup code)

```typescript
async function enforceMaxActiveWorkers(
  maxWorkers: number = 1
): Promise<{ allowed: boolean; reason?: string }> {
  const instanceId = crypto.randomUUID().slice(0, 8);
  
  // Create/update worker registration in database
  await db.workerRegistration.upsert({
    where: { instanceId },
    create: {
      instanceId,
      startedAt: new Date(),
      lastHeartbeatAt: new Date(),
      config: { maxWorkers }
    },
    update: { lastHeartbeatAt: new Date() }
  });

  // Count active workers (last heartbeat < 2 minutes ago)
  const activeWorkers = await db.workerRegistration.count({
    where: {
      lastHeartbeatAt: { gte: new Date(Date.now() - 120_000) }
    }
  });

  if (activeWorkers > maxWorkers) {
    return {
      allowed: false,
      reason: `Active worker count ${activeWorkers} exceeds max ${maxWorkers}`
    };
  }

  return { allowed: true };
}

// In Worker.startup():
const config = readWorkerConfigFromEnv();
const startup = await enforceMaxActiveWorkers(config.maxActiveWorkers ?? 1);
if (!startup.allowed) {
  console.error(`[worker:${this.instanceId}] Startup blocked: ${startup.reason}`);
  process.exit(1);
}
```

**Configuration:**
```env
MAX_ACTIVE_WORKERS=1  # Default single-worker
```

**Database schema addition:**
```typescript
model WorkerRegistration {
  instanceId         String    @id
  startedAt          DateTime  @default(now())
  lastHeartbeatAt    DateTime  @updatedAt
  config             Json      // { maxWorkers: number, concurrency: number }
  
  @@index([lastHeartbeatAt])  // for cleanup queries
}
```

**Heartbeat (run every 15s in Worker.tick()):**
```typescript
await db.workerRegistration.update({
  where: { instanceId: this.instanceId },
  data: { lastHeartbeatAt: new Date() }
});
```

**Cleanup (run on startup):**
```typescript
// Remove stale registrations (no heartbeat for >5 min)
await db.workerRegistration.deleteMany({
  where: {
    lastHeartbeatAt: { lt: new Date(Date.now() - 5 * 60 * 1000) }
  }
});
```

**Alert:** Page on-call if excess workers detected
```
worker_startup_denied_total: Number of workers rejected at startup
```

---

## PART 6: Demo Global Cap Persistence

**Current State:** In-memory counter resets on app restart  
**Problem:** Demo budget can be exceeded after deploy

### Solution: Database-Backed Quota

**File:** New `lib/demo-quota.ts`

```typescript
export async function checkDemoGlobalQuota(
  includeInCount: boolean = true
): Promise<{ allowed: boolean; remaining: number; resetAt: Date }> {
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  
  // Get or create today's quota record
  const quota = await db.demoQuota.upsert({
    where: { day: midnight.toISOString().split("T")[0] },
    create: {
      day: midnight.toISOString().split("T")[0],
      dailyLimit: parseInt(process.env.DEMO_GLOBAL_LIMIT_PER_DAY ?? "200"),
      submitted: includeInCount ? 1 : 0,
      accepted: 0,
      rejected: 0
    },
    update: includeInCount ? { submitted: { increment: 1 } } : undefined
  });

  const remaining = Math.max(0, quota.dailyLimit - quota.submitted);
  const resetAt = new Date(midnight.getTime() + 24 * 60 * 60 * 1000);

  return {
    allowed: remaining > 0,
    remaining,
    resetAt
  };
}
```

**Database schema:**
```typescript
model DemoQuota {
  id          Int     @id @default(autoincrement())
  day         String  @unique  // "2026-08-13"
  dailyLimit  Int     @default(200)
  submitted   Int     @default(0)  // All attempts
  accepted    Int     @default(0)  // Passed rate limit & cost checks
  rejected    Int     @default(0)  // Rejected by limit
  
  @@index([day])
}
```

**Usage in demo route:**
```typescript
const quota = await checkDemoGlobalQuota(true);
if (!quota.allowed) {
  return NextResponse.json(
    { error: "Demo quota exhausted for today. Try again tomorrow." },
    { status: 503 }
  );
}
```

**Metrics:**
```
demo_quota_remaining (gauge) — requests left today
demo_quota_reset_at (gauge) — Unix timestamp of next reset
demo_submissions_total (counter) — incremented atomically with submitted++
```

**Cleanup (run daily):**
```typescript
// Delete old quota records (>30 days)
await db.demoQuota.deleteMany({
  where: { day: { lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0] } }
});
```

---

## PART 7: Stripe Load Test (Safe Mode)

**Current State:** No load test of webhook endpoint  
**Instruction:** Test in Stripe test mode, not production

### Test Plan

**Environment:** Stripe test mode (sk_test_*)  
**Database:** Isolated staging database (or production with rollback plan)

**Scenarios:**

1. **Signature Validation Under Load**
   ```bash
   k6 run stripe-webhook.js \
     --vus 100 \
     --duration 2m \
     --env STRIPE_WEBHOOK_ENDPOINT=https://staging.example.com/api/stripe/webhook \
     --env STRIPE_WEBHOOK_SECRET=whsec_test_xxx
   ```

   Test:
   - Valid signature with correct body → 200
   - Invalid signature → 403
   - Signature timing consistent across 100 concurrent requests

2. **Event Replay & Idempotency**
   - Send same event 100 times → idempotent (credit only granted once)
   - Send different valid events concurrently → all processed
   - Out-of-order delivery → handled correctly

3. **Event Types**
   - `checkout.session.completed` → subscription created
   - `invoice.paid` → initial credits granted (once)
   - `customer.subscription.updated` → credit diff on upgrade
   - `invoice.payment_failed` → past_due status set
   - `customer.subscription.deleted` → plan downgraded
   - `charge.dispute.created` → flagged for review

4. **Failure Cases**
   - Database unavailable → 503 (will retry)
   - Timeout on third-party API → 202 accepted (async queue)
   - Duplicate event ID → 200 idempotent

5. **Constraints**
   - Connection pool doesn't exhaust
   - Response time p95 < 2 seconds
   - No memory leaks
   - No partial state (all-or-nothing atomicity)

**Evidence to Record:**
- k6 JSON output
- Database before/after credit snapshot
- Error logs (if any)
- Webhook retry count
- Test duration and timestamp

---

## PART 8: Verification Checklist (Pre-Production Gate)

### ✅ Tests Pass

- [ ] Run `npm test -- --run` from clean checkout
- [ ] Expected: 302/302 passing (currently 284/302)
- [ ] Commit: Exact hash
- [ ] Timestamp: When test suite ran
- [ ] Evidence: Full output saved

### ✅ Build Succeeds

- [ ] Run `npm run build` — Next.js production build
- [ ] Run `npm run build:worker` — Worker dist (~2.4MB)
- [ ] Run `npx tsc --noEmit` — Zero TypeScript errors

### ✅ Metrics Endpoint Implemented

- [ ] `/internal/metrics` route exists
- [ ] Protected by bearer token
- [ ] Returns Prometheus text format
- [ ] Contains safe metrics only (no PII)
- [ ] Rate limited
- [ ] Test: Unauthenticated → 401
- [ ] Test: Invalid token → 401
- [ ] Test: Authenticated → 200 with metrics

### ✅ Monitoring Plan Created

- [ ] `MONITORING_PLAN.md` exists
- [ ] Prometheus scrape config provided
- [ ] Grafana dashboard JSON provided
- [ ] Alert thresholds documented
- [ ] Runbook for each alert
- [ ] On-call procedure documented

### ✅ Worker Safety Guardrails

- [ ] `MAX_ACTIVE_WORKERS` configuration added
- [ ] Worker registration table in schema
- [ ] Startup check prevents excess workers
- [ ] Heartbeat runs every 15s
- [ ] Stale worker cleanup runs on startup
- [ ] Test: Excess worker → rejected at startup

### ✅ Demo Quota Persistent

- [ ] `DemoQuota` table in schema
- [ ] `checkDemoGlobalQuota()` function implemented
- [ ] Metrics exported: `demo_quota_remaining`
- [ ] Test: Quota doesn't reset on app restart
- [ ] Test: 100 concurrent requests → only 200 accepted

### ✅ Stripe Load Test (Test Mode Only)

- [ ] k6 scenarios run against test mode endpoint
- [ ] Signature validation holds under 100 VUs
- [ ] Idempotency proven: duplicate event → same result
- [ ] All event types tested
- [ ] Raw k6 output saved
- [ ] Database before/after snapshot saved

### ✅ Documentation Updated

- [ ] All certificates/handoff docs reflect actual status
- [ ] No claims of "302/302 passing" if tests failing
- [ ] No claims of features not implemented
- [ ] Exact commit hash documented for each claim
- [ ] Timestamps of verification added

---

## PART 9: Stop Conditions (Deployment Blockers)

**Do not proceed to deployment if:**

- ❌ Any test still failing (18 must go to 0)
- ❌ TypeScript errors (must be 0)
- ❌ Metrics endpoint not implemented
- ❌ Monitoring plan not created
- ❌ Worker safety guardrails not in place
- ❌ Demo quota not persistent
- ❌ Stripe load test not passed
- ❌ Any critical documentation contradictions
- ❌ No owner approval sign-off

---

## PART 10: Next Steps (This Session)

### Immediate (Next 1-2 Hours)

- [ ] **Fix 18 failing tests** in `lib/jobs/claim.test.ts`
  - Understand intended behavior of `shouldThrottle` and `shouldDegrade`
  - Update test mocks to match new return type
  - Verify return type is used correctly in worker
  - Re-run tests: expect 302/302 passing

### Short Term (Next 6-12 Hours)

- [ ] **Implement `/internal/metrics` endpoint**
  - Create `app/api/internal/metrics/route.ts`
  - Add authentication and rate limiting
  - Export safe metrics only
  - Add security tests

- [ ] **Create `MONITORING_PLAN.md`**
  - Prometheus configuration
  - Grafana dashboard JSON
  - Alert thresholds and runbooks
  - On-call procedures

### Medium Term (Next 1-2 Days)

- [ ] **Add worker safety guardrails**
  - `WorkerRegistration` table
  - Startup check
  - Heartbeat and cleanup

- [ ] **Make demo quota persistent**
  - `DemoQuota` table
  - `checkDemoGlobalQuota()` function
  - Add metrics

- [ ] **Stripe load test (test mode)**
  - k6 scenarios
  - Event replay tests
  - Idempotency verification

- [ ] **Update all documentation**
  - Mark claims with provenance
  - Remove unverified claims
  - Add exact timestamps

### Before Deployment

- [ ] Independent code review
- [ ] Owner sign-off on changes
- [ ] Database backup verified
- [ ] Rollback procedure tested
- [ ] Monitoring dashboard set up
- [ ] On-call checklist reviewed

---

**Prepared by:** System Verification Agent  
**Status:** Awaiting remediation  
**Do Not Deploy:** Until all sections complete and reviewed
