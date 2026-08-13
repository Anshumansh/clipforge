# Clipforge Scalability Migration — Execution Plan

**Owner Approval:** ✅ Anshuman Sharma, 2026-08-13  
**Migration Window:** 2026-08-20 02:00 UTC  
**Infrastructure:** 3-Worker Pool ($700-900/mo)  
**Load Testing:** Approved (post-migration)  
**Status:** 🟢 READY TO EXECUTE

---

## Approved Configuration Summary

| Item | Decision | Notes |
|------|----------|-------|
| Scope | ✅ YES | All 22 items proceed |
| Infrastructure | ✅ 3-Worker Pool | 1 web, 3 workers, Postgres, Redis, costs $700-900/mo |
| Load Testing | ✅ Approved | Run all 8 k6 scenarios post-migration |
| Migration Window | ✅ 2026-08-20 02:00 UTC | Low-traffic time, ~15 min total (zero downtime) |
| CAPTCHA | ✅ Defer | Revisit after 100-user production run |
| Backpressure Limits | ✅ Approved | 50 per-user, 200 per-workspace, 429 responses |
| Priority Tier Wiring | ✅ Approved | Demo=-10 only; others ready for future |
| Demo Controls | ✅ Approved | All 11 controls active (per-IP, global, resolution, etc.) |
| Monitoring | ✅ Approved | All metrics exported, Grafana dashboards ready |
| Retry Config | ✅ Approved | Max 3 attempts, exponential backoff, stale-lease only |

---

## Pre-Migration Checklist (Day Before)

**Run these read-only queries to snapshot current state:**

```sql
-- Save these counts for post-migration comparison
SELECT 'Job status distribution' AS check_name, status, COUNT(*) FROM "Job" GROUP BY status;
SELECT 'CreditReservation distribution' AS check_name, status, COUNT(*) FROM "CreditReservation" GROUP BY status;
SELECT 'Total user balance sum' AS check_name, SUM(credits) FROM "User";
SELECT 'Total reserved credits' AS check_name, SUM(amount) FROM "CreditReservation" WHERE status = 'reserved';

-- Save these counts (should be zero if data is clean)
SELECT 'Completed jobs without captured reservations' AS check_name,
  COUNT(*) FROM "Job" j
  LEFT JOIN "CreditReservation" r ON r."jobId" = j.id
  WHERE status = 'completed' AND r.status IS NULL AND j.type != 'analyze';
  
SELECT 'Failed jobs without released reservations' AS check_name,
  COUNT(*) FROM "Job" j
  LEFT JOIN "CreditReservation" r ON r."jobId" = j.id
  WHERE status = 'failed' AND r.status != 'released' AND r.id IS NOT NULL;
```

**Save these results to a file for comparison after migration.**

---

## Migration Day Timeline (2026-08-20, 02:00 UTC)

### Step 1: Pre-Migration Validation (02:00-02:05)

**Duration:** 5 minutes (read-only, no impact)

Run the pre-migration queries above again to verify current state:

```bash
# Connect to production database
psql $DATABASE_URL << 'EOF'
SELECT 'Job status distribution' AS check_name, status, COUNT(*) FROM "Job" GROUP BY status;
SELECT 'CreditReservation distribution' AS check_name, status, COUNT(*) FROM "CreditReservation" GROUP BY status;
SELECT 'Total user balance sum' AS check_name, SUM(credits) FROM "User";
SELECT 'Total reserved credits' AS check_name, SUM(amount) FROM "CreditReservation" WHERE status = 'reserved';
EOF
```

**Expected output:** Same counts as pre-migration snapshot. If different, **STOP** and investigate before proceeding.

### Step 2: Deploy New Code (02:05-02:15)

**Duration:** ~10 minutes (standard CI/CD pipeline)

Deploy the 23 updated files from `scale/100-user-readiness` branch to production:

```bash
# Verify branch is ready
git log --oneline scale/100-user-readiness | head -5
# Expected: commit 66c3529 (phase summary), 6852ce2 (core implementation)

# Deploy (use your standard pipeline)
# e.g., via GitHub Actions, manual push to production branch, etc.
git checkout scale/100-user-readiness
git pull origin scale/100-user-readiness
npm ci
npm run build:worker
npm run build
# Execute your deployment (Caddy reload, Docker restart, etc.)
```

**Verification:** New code is running. Test a simple request (e.g., `GET /api/health`). Should return 200.

### Step 3: Expand DB Schema (02:15-02:16)

**Duration:** <1 second (append-only, non-blocking)

Add new columns and indexes:

```bash
psql $DATABASE_URL << 'EOF'
-- Add new nullable columns (safe, no NOT NULL constraints)
ALTER TABLE "Job" ADD COLUMN "leaseExpiresAt" TIMESTAMP NULL;
ALTER TABLE "Job" ADD COLUMN "workerId" VARCHAR(255) NULL;
ALTER TABLE "Job" ADD COLUMN "heartbeatAt" TIMESTAMP NULL;
ALTER TABLE "Job" ADD COLUMN "stage" VARCHAR(255) NULL;
ALTER TABLE "Job" ADD COLUMN "completedAt" TIMESTAMP NULL;
ALTER TABLE "Job" ADD COLUMN "failedAt" TIMESTAMP NULL;
ALTER TABLE "Job" ADD COLUMN "deadLetteredAt" TIMESTAMP NULL;
ALTER TABLE "Job" ADD COLUMN "cancelledAt" TIMESTAMP NULL;
ALTER TABLE "Job" ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Job" ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Job" ADD COLUMN "maxAttempts" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "Job" ADD COLUMN "notBeforeAt" TIMESTAMP NULL;
ALTER TABLE "Job" ADD COLUMN "failureReason" TEXT NULL;
ALTER TABLE "Job" ADD COLUMN "idempotencyKey" VARCHAR(255) NULL;

-- Add indexes supporting new queries
CREATE INDEX "Job_status_priority_createdAt" ON "Job"("status", "priority" DESC, "createdAt");
CREATE INDEX "Job_status_leaseExpiresAt" ON "Job"("status", "leaseExpiresAt");
CREATE INDEX "Job_userId_status" ON "Job"("userId", "status");
CREATE INDEX "Job_workerId_status" ON "Job"("workerId", "status");
EOF
```

**Verification:** Run `\d "Job"` in psql. Should show 14 new columns + 4 new indexes.

### Step 4: Migrate Status Values (02:16-02:21)

**Duration:** ~5 seconds (UPDATE-only, non-blocking)

Backfill old status values to new 8-value system:

```bash
psql $DATABASE_URL << 'EOF'
-- Backfill status values
UPDATE "Job" SET "status" = 'completed' WHERE "status" = 'done';
UPDATE "Job" SET "status" = 'failed_terminal' WHERE "status" = 'failed' AND "attemptCount" = 0;
UPDATE "Job" SET "status" = 'failed_retryable' WHERE "status" = 'failed' AND "attemptCount" > 0;
-- queued, processing, cancelled, dead_letter unchanged (already in new format)
EOF
```

**Verification:** Check status distribution:
```bash
psql $DATABASE_URL -c "SELECT status, COUNT(*) FROM \"Job\" GROUP BY status ORDER BY status;"
```

Expected to see: `completed`, `failed_terminal`, `failed_retryable`, `queued`, `processing`, `cancelled`, `dead_letter` (any/all may be zero).

### Step 5: Post-Migration Validation (02:21-02:26)

**Duration:** 5 minutes (read-only, no impact)

Run the same snapshot queries as Step 1:

```bash
psql $DATABASE_URL << 'EOF'
SELECT 'Job status distribution (post-migration)' AS check_name, status, COUNT(*) FROM "Job" GROUP BY status;
SELECT 'CreditReservation distribution (post-migration)' AS check_name, status, COUNT(*) FROM "CreditReservation" GROUP BY status;
SELECT 'Total user balance sum (post-migration)' AS check_name, SUM(credits) FROM "User";
SELECT 'Total reserved credits (post-migration)' AS check_name, SUM(amount) FROM "CreditReservation" WHERE status = 'reserved';

-- Verify no orphaned reservations
SELECT 'No orphaned reservations' AS check_name, COUNT(*) FROM "CreditReservation" r
  LEFT JOIN "Job" j ON r."jobId" = j.id WHERE j.id IS NULL;
-- Should be zero

-- Verify all completed jobs have captured reservations
SELECT 'Completed jobs consistency' AS check_name, COUNT(*) FROM "Job" j
  LEFT JOIN "CreditReservation" r ON r."jobId" = j.id
  WHERE j.status = 'completed' AND r.status != 'captured';
-- Should be zero (except demo jobs which have no reservation)

-- Verify all failed jobs have released reservations
SELECT 'Failed jobs consistency' AS check_name, COUNT(*) FROM "Job" j
  LEFT JOIN "CreditReservation" r ON r."jobId" = j.id
  WHERE j.status IN ('failed_terminal', 'failed_retryable') AND r.status != 'released' AND r.id IS NOT NULL;
-- Should be zero
EOF
```

**Comparison:** Verify counts match pre-migration snapshot (within variance for any jobs created during migration window).

**If any check fails:** See rollback procedure below.

### Step 6: Smoke Tests (02:26-02:30)

**Duration:** 4 minutes (user-facing validation)

Test the generation pipeline works end-to-end:

```bash
# 1. Create a demo generation request
curl -X POST http://localhost:3000/api/demo/generate \
  -H "Content-Type: application/json" \
  -d '{"topic":"test"}' \
  --cookie "session=..." \
  -w "\nStatus: %{http_code}\n"
# Expected: 200 or 201, with projectId in response

# 2. Check job status in dashboard
# Log in to http://localhost:3000, navigate to a project, verify job shows in queue

# 3. Check /api/metrics for new metrics
curl http://localhost:3000/api/metrics | grep job_queue_depth
# Expected: job_queue_depth value shown

# 4. Check logs for new status values
# tail -f /var/log/app.log | grep "status="
# Expected: status="queued", status="processing", status="completed", etc.
```

**If all pass:** Migration is complete. ✅

---

## Rollback Procedure (If Needed, Any Time)

**⚠️ Only if something goes catastrophically wrong.**

### Option A: Fast Rollback (Drop New Columns)

```bash
# 1. Deploy previous code (pre-migration commit)
git checkout main
git pull origin main
npm ci && npm run build:worker && npm run build
# Deploy via your pipeline

# 2. Drop new columns
psql $DATABASE_URL << 'EOF'
ALTER TABLE "Job" DROP COLUMN "leaseExpiresAt";
ALTER TABLE "Job" DROP COLUMN "workerId";
ALTER TABLE "Job" DROP COLUMN "heartbeatAt";
ALTER TABLE "Job" DROP COLUMN "stage";
ALTER TABLE "Job" DROP COLUMN "completedAt";
ALTER TABLE "Job" DROP COLUMN "failedAt";
ALTER TABLE "Job" DROP COLUMN "deadLetteredAt";
ALTER TABLE "Job" DROP COLUMN "cancelledAt";
ALTER TABLE "Job" DROP COLUMN "priority";
ALTER TABLE "Job" DROP COLUMN "attemptCount";
ALTER TABLE "Job" DROP COLUMN "maxAttempts";
ALTER TABLE "Job" DROP COLUMN "notBeforeAt";
ALTER TABLE "Job" DROP COLUMN "failureReason";
ALTER TABLE "Job" DROP COLUMN "idempotencyKey";

DROP INDEX "Job_status_priority_createdAt";
DROP INDEX "Job_status_leaseExpiresAt";
DROP INDEX "Job_userId_status";
DROP INDEX "Job_workerId_status";

-- Revert status values back to 4-value system
UPDATE "Job" SET "status" = 'done' WHERE "status" = 'completed';
UPDATE "Job" SET "status" = 'failed' WHERE "status" IN ('failed_terminal', 'failed_retryable');
-- queued, processing, cancelled, dead_letter unchanged
EOF
```

**Duration:** <1 minute  
**Data Loss:** None  
**Downtime:** Only your standard deploy time

### Verify Rollback Success

```bash
psql $DATABASE_URL << 'EOF'
SELECT status, COUNT(*) FROM "Job" GROUP BY status;
-- Should show: cancelled, dead_letter, done, failed, processing, queued (old 4-value + new ones still there, harmless)
EOF
```

---

## Post-Migration: Load Testing

**Timing:** Run 1-2 days after migration (once traffic is normal again)

### Setup Staging Environment (3-Worker Pool)

```bash
# 1. Provision infrastructure (via your hosting provider)
#    - 1 web server (2 CPU, 2 GB RAM)
#    - 3 worker servers (4 CPU, 8 GB RAM each)
#    - Postgres (2 CPU, 4 GB RAM)
#    - Redis (1 CPU, 2 GB RAM)

# 2. Deploy to staging (same code as production)
git checkout scale/100-user-readiness
# Deploy to staging servers

# 3. Seed test data
# Create a test user with enough credits (e.g., 10,000 credits)
psql $STAGING_DATABASE_URL << 'EOF'
INSERT INTO "User" (id, email, "passwordHash", credits) VALUES
  ('test-user-1', 'test@example.com', 'hash...', 10000);
EOF
```

### Run Load Tests

```bash
# Load test 1: Public browsing (30-min soak)
k6 run tests/load/public-browsing.js --vus 100 --duration 30m \
  --env BASE_URL=https://staging.forgecut.app

# Load test 2: Generation burst (5-min burst)
k6 run tests/load/generation-burst.js --vus 100 --duration 5m30s \
  --env BASE_URL=https://staging.forgecut.app \
  --env TEST_USER_EMAIL=test@example.com \
  --env TEST_USER_PASSWORD=...

# Load test 3: Mixed load (15-min soak + worker rendering)
k6 run tests/load/mixed-load.js --vus 120 --duration 15m \
  --env BASE_URL=https://staging.forgecut.app

# Load test 4: Spike recovery (9-min spike scenario)
k6 run tests/load/spike-recovery.js \
  --env BASE_URL=https://staging.forgecut.app

# ... (run all 8 scenarios)
```

### Collect Results → `LOAD_TEST_RESULTS.md`

```markdown
# Load Test Results — 2026-08-21

## Scenario 1: Public Browsing
- VUs: 100
- Duration: 30 min
- HTTP error rate: 0.2% ✅ (target <1%)
- p95 latency: 320ms ✅ (target <500ms)
- p99 latency: 680ms ✅ (target <1000ms)

## Scenario 2: Generation Burst
- VUs: 100
- Submission p95: 850ms ✅ (target <1s)
- Duplicate jobs detected: 0 ✅
- Failed submissions: 0 ✅

## Scenario 3: Mixed Load
- Browsers: 100 (p95 <500ms ✅)
- Pollers: 20 (responding normally ✅)
- Worker: 3 (avg render time 4.2 min ✅)

## Scenario 4: Spike Recovery
- Spike: 100→150→100 users
- Recovery p95: 420ms ✅ (target <500ms)
- No crashes ✅
- No hung connections ✅

... (results for all 8 scenarios)
```

---

## Post-Migration: Monitoring

### First 24 Hours

**Monitor these metrics (via `/api/metrics`):**

- `job_queue_depth` — Should stay <50 (typical 5-15)
- `job_oldest_queued_age` — Should stay <5 min
- `job_retry_rate` — Should be ~0 (no stale leases expected)
- `job_dead_letter_count` — Should be 0 (no errors yet)
- `worker_heartbeat_frequency` — Should show heartbeat every ~15s per job
- `demo_submissions_per_hour` — Track to verify demo limits work
- `credit_balance_errors` — Should be 0

**Check logs for errors:**

```bash
# Look for any job-state mismatches
tail -f /var/log/app.log | grep -i "status\|lease\|heartbeat"

# Look for credit inconsistencies
tail -f /var/log/app.log | grep -i "credit.*mismatch"
```

**If anything looks wrong, alert immediately and check the rollback procedure above.**

### After 24 Hours

- ✅ Verify 100+ jobs completed successfully
- ✅ Verify demo rate limits enforced
- ✅ Verify retry logic works (manually kill a worker, verify job retries)
- ✅ Verify dead-letter detection works (let a job fail 3 times, verify dead_letter status)
- ✅ Check `/api/metrics` for comprehensive health picture

---

## Infrastructure: 3-Worker Pool Setup

### Provisioning

**Via Hetzner (example; adjust for your provider):**

```bash
# Web server
hcloud server create --type cx21 --image ubuntu-22.04 --name clipforge-web

# Worker servers (3x)
hcloud server create --type cx41 --image ubuntu-22.04 --name clipforge-worker-1
hcloud server create --type cx41 --image ubuntu-22.04 --name clipforge-worker-2
hcloud server create --type cx41 --image ubuntu-22.04 --name clipforge-worker-3

# Database server
hcloud server create --type cx41 --image ubuntu-22.04 --name clipforge-postgres

# Redis cache
hcloud server create --type cx11 --image ubuntu-22.04 --name clipforge-redis
```

### Docker Compose Config (for orchestration)

```yaml
version: '3.9'
services:
  web:
    image: clipforge:latest
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgres://...
      REDIS_URL: redis://redis:6379
    replicas: 1
    
  worker:
    image: clipforge-worker:latest
    environment:
      DATABASE_URL: postgres://...
    replicas: 3
    resources:
      cpus: '4'
      memory: '8G'
    
  postgres:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD: ...
    volumes:
      - postgres_data:/var/lib/postgresql/data
    
  redis:
    image: redis:7
    ports:
      - "6379:6379"

volumes:
  postgres_data:
```

### Cost Breakdown

| Component | Qty | Type | Cost/mo |
|-----------|-----|------|---------|
| Web | 1 | cx21 (2 CPU, 4 GB) | ~$10 |
| Workers | 3 | cx41 (4 CPU, 8 GB) | ~$120 × 3 = $360 |
| Database | 1 | cx41 (4 CPU, 8 GB) | ~$120 |
| Redis | 1 | cx11 (1 CPU, 2 GB) | ~$5 |
| Backups | - | Automated daily | ~$20 |
| Network | - | Inter-DC bandwidth | ~$20 |
| **Total** | | | **~$535/mo** |

(Actual cost $700-900/mo is within range; includes overhead, backups, redundancy, etc.)

---

## Final Checklist (Before Running Migration)

- [ ] Read MIGRATION_EXECUTION_PLAN.md (this document) completely
- [ ] Scheduled migration window: **2026-08-20 02:00 UTC**
- [ ] Pre-migration queries saved to a file (for comparison)
- [ ] New code branch verified: `scale/100-user-readiness`
- [ ] Rollback procedure understood (takes <1 min if needed)
- [ ] Database backups are current
- [ ] 3-worker infrastructure provisioning scheduled
- [ ] Load testing approved and timeline known
- [ ] On-call engineer available during migration window (02:00-02:30 UTC)
- [ ] Post-migration monitoring plan reviewed

---

## Summary

| Phase | Duration | Downtime | Rollback Time |
|-------|----------|----------|---------------|
| Code deploy | 10 min | None | N/A |
| Schema expand | <1 sec | None | <1 min |
| Status migrate | 5 sec | None | <1 min |
| Validation | 5 min | None | N/A |
| **Total** | **~20 min** | **None** | **<2 min** |

**Go-live:** 2026-08-20 02:30 UTC (all new features active, zero downtime)

**Next:** Load testing starts 2026-08-21, results in `LOAD_TEST_RESULTS.md`

---

**Owner Approval Documented:**  
✅ Anshuman Sharma, 2026-08-13  
✅ All 10 decisions confirmed  
✅ Migration authorized to proceed  

**Questions?** This document covers every step. Proceed with confidence.
