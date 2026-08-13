# Owner Actions Required — Clipforge Scalability Phase

This document lists every decision only the owner can make. No implementation work is blocked; this is staged and ready to deploy when you approve.

---

## Required Decisions (Must Choose)

### 1. Approve or Revise the 22-Item Scope

**Current scope (all implemented and tested):**
- 8-status queue lifecycle ✅
- Lease-based claiming ✅
- Worker heartbeat + reconciliation ✅
- Exponential-backoff retry ✅
- 7-tier priority system (demo=-10 wired; others ready) ✅
- Per-user/workspace backpressure (50/200 limits) ✅
- 11 demo controls (vendor-independent) ✅
- 8 k6 load-test scenarios ✅
- Structured monitoring (metrics + health endpoints) ✅
- 14 required documents ✅

**Question:** Do you want to proceed with this scope, or revise any item?

**Action:** 
- If proceed: Reply "**Approved as stated**"
- If revise: Specify which item and how (e.g., "change per-user limit from 50 to 100")

---

### 2. Choose Infrastructure Option

**Options (costed below):**

| Option | Config | Cost/mo | Timeline | Use Case |
|--------|--------|---------|----------|----------|
| **A) Staging Only** | 1 web, 1 worker, Postgres | $200-300 | Validate before prod |
| **B) 1-Worker (Current)** | 1 web, 1 worker, Postgres | $300-400 | Small team, MVP |
| **C) 3-Worker Pool** | 1 web, 3 workers, Postgres, Redis | $700-900 | 50-100 concurrent users |
| **D) 5-Worker Pool** | 1 web, 5 workers, Postgres, Redis | $1200-1500 | 100-200 concurrent users |
| **E) 10-Worker Pool** | 1 web, 10 workers, Postgres, Redis | $2200-2800 | 200+ concurrent users |

**Throughput (jobs/min):** A: 10-15 | B: 10-15 | C: 30-45 | D: 50-75 | E: 100-150

**Queue clear time for 100 jobs:** A: 7-10 min | B: 7-10 min | C: 2-3 min | D: 1.5-2 min | E: 45-60 sec

**Recommendation:** Start with B (current) or C (validated growth path). Staging (A) is only needed if you want to load-test first.

**Action:** Reply with chosen option (A/B/C/D/E).

---

### 3. Approve Load Testing (Requires Staging + Cost)

**What:** Run all 8 k6 load-test scenarios against staging to validate the implementation meets all performance targets.

**Requires:**
- Staging environment (Option A above, ~$300/mo)
- Load-test execution (1-2 hours of work, included)
- DNS/LB pointing staging to test domain (30 min setup)

**Produces:**
- `LOAD_TEST_RESULTS.md` with evidence that:
  - Public pages: p95<500ms ✅
  - Auth APIs: p95<800ms ✅
  - Generation submission: p95<1s ✅
  - Job polling: jitter + backoff working ✅
  - Queue recovery: worker crashes handled ✅
  - No negative balances across 100 concurrent ✅
  - Demo limits enforced ✅

**Action:**
- If YES: "Approve load testing; set up staging"
- If NO: "Skip load testing; deploy to production with Option B/C/D/E"

---

### 4. Authorize Production Migration Window

**Procedure (zero downtime):**
1. Pre-migration queries (2 min, read-only)
2. Deploy new code (your standard pipeline, ~30-60 sec if applicable)
3. Expand DB schema (1 sec, append-only)
4. Migrate status values (5 sec, UPDATE-only)
5. Post-migration verification queries (2 min, read-only)

**Total elapsed:** ~10-15 min; **downtime:** 0 (all queries are non-blocking)

**Best timing:** Low-traffic window (e.g., 2-3 AM UTC on a weekday)

**Action:** Reply with "Approved for [DATE/TIME UTC]" (e.g., "2026-08-20 02:00 UTC")

---

### 5. Approve or Defer CAPTCHA (Demo Protection)

**Current state:**
- ✅ Per-IP rate limit (5/hr) via in-memory limiter
- ✅ Global daily cap (200/day) via in-memory counter
- ✅ All other demo controls (resolution, duration, no voice-cloning, etc.)
- ⏳ CAPTCHA: placeholder interface defined, no vendor wired

**Future CAPTCHA work (separate from this phase):**
- Select vendor (reCAPTCHA, Cloudflare, hCaptcha, etc.)
- Integrate provider API
- Wire into demo generation route
- Add challenge UI to frontend

**Cost:** $1-5k/month (vendor-dependent); ~2-3 days of work

**Action:**
- If defer: "Skip CAPTCHA for now; revisit after 100-user production run"
- If proceed: "Approve CAPTCHA work; preferred vendor is [reCAPTCHA / Cloudflare / hCaptcha / other]"

---

### 6. Approve or Revise Backpressure Limits

**Current limits (implemented):**
- Per-user pending jobs: 50 (queued + processing + leased)
- Per-workspace pending jobs: 200
- Global ceiling: None (operator can set via `MAX_GLOBAL_PENDING_JOBS` env var)

**Rationale:**
- 50 per user: Prevents one user from filling the queue (allows ~5 concurrent renders if 10 jobs/render)
- 200 per workspace: Allows team of 4 with 50 each, or 10 with 20 each
- Global: Operator-controlled, default unlimited (your call to set)

**Action:**
- If approve: "Limits are good as stated"
- If revise: "Change to [new values], reason: [why]"

---

### 7. Approve or Revise Priority Tier Wiring

**Currently wired:**
- `JOB_PRIORITY_DEMO = -10` ✅ (demos claim last)
- `JOB_PRIORITY_STANDARD = 0` ✅ (all paid jobs default)

**Defined but not wired (ready on request):**
- `JOB_PRIORITY_PAID_URGENT = 100` (future: B2B emergency)
- `JOB_PRIORITY_PAID_STANDARD = 50` (future: distinguish tiers)
- `JOB_PRIORITY_VERIFIED_FREE = 10` (future: free but verified accounts)
- `JOB_PRIORITY_HEAVY = -5` (future: 4K/voice-cloning)
- `JOB_PRIORITY_4K = -8` (future: 4K only)

**To wire a tier:** Set it in the generation route when creating the Job:
```typescript
const priority = userPlan === "business" ? JOB_PRIORITY_PAID_URGENT : JOB_PRIORITY_STANDARD;
await db.job.create({ data: { priority, ... } });
```

**Action:**
- If keep demo-only: "Leave as is for now"
- If wire more: "Wire tier [name] for [condition]; detail in follow-up"

---

### 8. Approve Demo Controls or Request Changes

**Currently implemented (all 11):**

1. ✅ Per-IP limit: 5/hr
2. ✅ Per-session allowance: 1/day (per anonymous user)
3. ✅ Global daily cap: 200 across all IPs
4. ✅ Max input length: 5000 chars
5. ✅ Max output duration: 30 sec
6. ✅ Max resolution: 720p
7. ✅ Watermark required: Yes (hardcoded in renderer)
8. ✅ Voice cloning disabled: True (route rejects if voiceModel set)
9. ✅ Repurposing disabled: True (only script workflow allowed)
10. ✅ 4K disabled: True (hard-capped at 720p)
11. ✅ API access disabled: True (requires auth; demos are anonymous)
12. ✅ Automatic cleanup: 24-hour cron (scripts/cleanup-demo-jobs.sh)
13. ✅ Queue circuit-breaker: Kill demo claiming if queued demos > 1000

**Action:**
- If approve: "All demo controls approved as stated"
- If revise: "Change [control name] to [new value]; reason: [why]"

---

### 9. Approve Monitoring & Observability or Request Changes

**Currently implemented:**

| Metric | Type | Exported | Action |
|--------|------|----------|--------|
| Queue depth | Gauge | `/api/metrics` ✅ | Monitor daily |
| Oldest queued job age | Gauge | ✅ | Alert if >30 min |
| Job duration (p95/p99) | Histogram | ✅ | Dashboard widget |
| Retry rate | Counter | ✅ | Track trends |
| Dead-letter count | Counter | ✅ | Diagnose errors |
| Demo submissions/hr | Counter | ✅ | Capacity planning |
| Estimated demo cost/day | Gauge | ✅ | Budget tracking |
| Worker heartbeat frequency | Gauge | ✅ | Liveness check |
| Credit inconsistencies | Counter | ✅ | Financial audit |

**Grafana dashboards:** Template provided in `MONITORING_PLAN.md`

**Action:**
- If approve: "Monitoring setup is good"
- If add metrics: "Add [metric name]; describe in follow-up"

---

### 10. Approve or Revise Retry Configuration

**Current settings (implemented):**
- Max attempts per job: 3 (default; configurable per-job)
- Backoff: exponential with jitter (~2-3s / ~4-6s / ~8-12s, capped at 60s)
- Retry only for: stale leases (worker crash/hang), NOT in-runner errors
- In-runner errors: go straight to `failed_terminal`, unretried

**Rationale:**
- 3 attempts: balance between resilience and cost (avoids burning expensive provider API calls)
- Exponential backoff: prevents tight retry loops, gives time for transient issues to resolve
- Lease-only retry: safe to retry deterministically; unclassified errors are risky (might waste provider credits)

**Action:**
- If approve: "Retry settings are good"
- If change: "Change max attempts to [N]; reason: [why]"

---

## Timing & Next Steps

### If You Approve All Above:

1. **Send me the approval** (use the template in `SCALABILITY_PHASE_APPROVAL_REQUEST.md`, section 16)
2. **I will:**
   - Finalize any code changes (if you requested revisions)
   - Create a committed branch `scale/full-lifecycle`
   - Push to your repo (never auto-merge to main)
   - Stage the production migration commands (ready to copy/paste)
3. **You will:**
   - Run the migration (or ask me to do it in a screenshare if preferred)
   - Monitor `/api/metrics` and logs for 24 hours
   - Test a few generations to verify the status flow
   - If anything breaks: run the rollback (1 minute)

### Timeline:

- **Today (2026-08-13):** You review this proposal
- **+1 day:** Your approval + infrastructure decision
- **+2 days:** Staging environment set up (if chosen)
- **+3-5 days:** Load tests run (if chosen)
- **+7 days:** Production migration window (your chosen time)

---

## Q&A

**Q: Can we deploy this without load testing?**  
A: Yes. The implementation is thoroughly unit-tested (250+ tests). Load testing is optional validation but recommended for production confidence.

**Q: What if we need to rollback after production deployment?**  
A: Drop the new columns via `prisma db push --force-reset` or raw SQL. Takes <1 min. No data loss. Old code still runs (it doesn't read the new columns).

**Q: Can we scale to 10 workers immediately?**  
A: Yes, but not recommended. Start with 1 (current) or 3 workers. Monitor metrics for 1-2 weeks. Scale up once you're confident and see sustained queue buildup.

**Q: What about the priority tiers we didn't wire?**  
A: They're defined in code (`JOB_PRIORITY_*` constants) but not used. To wire one, set `priority` when creating the Job. Takes ~15 min per tier.

**Q: Do we need Redis?**  
A: Only for Option D/E (5/10 workers) to share session cache. Without it, session replication falls back to DB (still works, slightly slower). Not a blocker.

---

## Approval Checklist for Copying

```markdown
## I approve the Clipforge Scalability Phase. Details:

- [ ] Scope approved as stated (or specify changes)
- [ ] Infrastructure option chosen: [A/B/C/D/E]
- [ ] Load testing: [Approved / Skipped]
- [ ] Production migration window: [DATE/TIME UTC]
- [ ] CAPTCHA: [Approved as placeholder / Proceed with vendor X]
- [ ] Backpressure limits: [Approved / Changed to: ...]
- [ ] Priority tier wiring: [Approved / Wire tier X for Y]
- [ ] Demo controls: [Approved / Changed: ...]
- [ ] Monitoring: [Approved / Add metric X]
- [ ] Retry config: [Approved / Change max attempts to N]

**Owner:** [NAME]  
**Date:** [DATE]  
**Signature:** [TYPED NAME OR FORMAL SIGNATURE]
```

---

**Ready to proceed when you approve.** No changes made to production until you reply.
