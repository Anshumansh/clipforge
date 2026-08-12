# Clipforge — Performance & Scalability Implementation (this pass)

Written 2026-08-13, `scale/100-user-readiness` branch. Documents exactly what was
implemented in this pass of the 100-concurrent-user readiness program, against real
inspection of the current codebase — not a restatement of the full 26-section brief that
prompted it. See `CAPACITY_MODEL.md` (prior pass) for throughput/cost math and
`QUEUE_RECOVERY.md` for the queue-lifecycle redesign in full detail.

## What was already true before this pass (found during inspection, not built here)

Worth stating plainly, since assuming the opposite would have meant duplicating working
code: the homepage (`app/page.tsx`) is already ISR (`revalidate = 300`), its "videos
generated" counter is already behind `unstable_cache` at the same 300s TTL (not queried
per-request), `pricing/page.tsx` already caches its one dynamic dependency (competitor
benchmarks) the same way, and every other public marketing page (`terms`, `privacy`,
`trust`, `how-it-works`, `changelog`, `contact`, `for/*`) has no dynamic API usage at all,
so Next statically prerenders them by default — the best possible caching, with zero
code needed. `roadmap/page.tsx` is correctly `force-dynamic` because it's genuinely
per-user (vote state, admin check) — exactly the "don't cache authenticated content
publicly" rule already being followed. The homepage's video previews
(`components/hero-demo.tsx`'s `PhoneMockup`, `components/phone-showcase.tsx`) already
lazy-load via `IntersectionObserver` and use `preload="metadata"`, never autoplay with
sound (always `muted`), and show a placeholder until ready.

## What was implemented this pass

### 1. Homepage video: eager metadata fetch on mount → load on first interaction

`ClipTile` (the three small hero-adjacent preview tiles) set `<video src={clip.src}>`
unconditionally on mount, so `preload="metadata"` began fetching for all three
10-30MB-range files on every homepage load regardless of whether a visitor ever
interacted with them. Now the `<video>` element (and its `src`) isn't rendered until
first hover/tap/focus. Also fixed misleading "hover to preview" copy (tap already worked
functionally via the existing `onClick` handler; the text just didn't say so).

**Before/after, measured**: not independently re-measured in this pass (no browser
profiling session run) — this is a structural fix (zero video bytes requested pre-
interaction vs. 3 concurrent metadata fetches on every load), not a number I have a
before/after trace for. Flagging that honestly rather than inventing a KB figure.

### 2. Dashboard job-status polling

`components/project-status.tsx` polled every 2000ms flat, no jitter, no slowdown, no
tab-visibility awareness, hitting `GET /api/projects/[id]` (a real `findFirst` + a
workspace-access subquery) on every tick. Now: jittered 4-5s base interval (down to
~12s after 60s of continuous polling), skipped entirely while the tab is hidden
(`document.hidden` checked fresh each tick, no missed-tick backlog to reconcile on
return). At 100 concurrently-active-job viewers, this is the direct, proportional
reduction in sustained polling-driven DB query volume the brief's section 8 asks for.

### 3. Demo generation: company-wide cap + kill switch (prior pass, `dd609d7`)

Already landed on this branch before this session: `DEMO_GLOBAL_LIMIT_PER_DAY` (default
200/day across all anonymous visitors combined, independent of the existing per-IP
limit) and `DEMO_GENERATION_ENABLED` kill switch. This pass adds demo jobs' explicit
lowest-priority tier (`JOB_PRIORITY_DEMO = -10`) on top of that — see below.

### 4. Queue lifecycle — the centerpiece of this pass

Full detail in `QUEUE_RECOVERY.md`. Summary: additive Prisma migration (lease, worker
heartbeat, attempt count, priority, dead-letter, cancellation fields on `Job`), atomic
lease-based claiming with priority ordering, periodic heartbeat renewal from the worker
while a job is in flight, lease-aware stale-job reconciliation (replacing the old
"unconditionally fail every processing job on startup" behavior) that runs on both
startup and a recurring timer, retry-with-exponential-backoff for worker-crash recovery
specifically (not blind retry of unclassified in-runner errors — see
`QUEUE_RECOVERY.md` §2 for why), dead-lettering after exhausted retries, and a
demo-lowest-priority wire-up so demos can never outrank a paid job in claim order.

### 5. `/api/health/live` (prior pass, `dd609d7`)

A pure liveness probe (no DB/storage I/O), additive alongside the existing
`/api/health` — see that commit for detail. Directly addresses section 9's "readiness
and liveness are different checks" requirement, though nothing currently polls it (no
orchestrator/load-balancer wired to use it yet — that's an infrastructure decision, not
a code gap).

### 6. k6 load-test suite (code only — not run)

`tests/load/` — five scenario scripts matching section 19 exactly (public browsing 30-min
soak, authenticated dashboard, generation burst, mixed load, spike-and-recovery), plus a
README covering how to run them, required env vars, and the explicit "never against
production without approval" constraint. **None of these have been executed against
anything** — no staging environment exists to run them against, and running them against
production requires separate explicit approval per repo rules. This is infrastructure
for a test that hasn't happened yet, not a claim that load testing occurred.

## Verification

277 → 302 tests (29 files), all passing. `tsc --noEmit` clean. `next build` and
`npm run build:worker` both succeed. No `prisma db push` was run against any database —
the schema change exists only in `prisma/schema.prisma` on this branch; see
`QUEUE_RECOVERY.md` §5 for the exact apply/rollback commands, pending approval.

## Explicitly not done this pass (with the exact reason)

- **Database query/index audit across every listed area** (dashboard, job list, teams,
  Stripe events, cost records, admin reporting, Trend Radar) — section 7's full scope.
  Only the job-status polling query's *call frequency* was addressed (§2 above); the
  query itself, and every other listed query, was not profiled or indexed this pass.
  Reason: no `EXPLAIN ANALYZE` access to a production-equivalent dataset in this session,
  and guessing at indexes without query-plan evidence would violate the brief's own
  "implement only evidence-based indexes" instruction.
- **Bundle-size report / CI bundle-size gate** (section 5) — not built. Reason: needs a
  baseline captured and a regression threshold agreed, neither of which exists yet.
- **CDN configuration/cost proposal** (section 3) — not prepared. Reason: genuinely new
  infrastructure decision requiring owner approval before even drafting a specific
  vendor/cost, per repo rule #7.
- **Server Components refactor / dynamic imports / dependency audit** (section 5) — not
  attempted. Reason: real, substantial refactor work across the dashboard's client
  components; scoped out in favor of the queue-lifecycle work, which is the higher-stakes
  (money-handling) piece.
- **Priority tiers beyond demo** (section 13's other 6 tiers) — see `QUEUE_RECOVERY.md`
  §2. The `priority` field and ordering exist; only demo is wired to a value.
- **In-flight job cancellation** — see `QUEUE_RECOVERY.md` §2. Queued-job cancellation
  is implemented and tested; cancelling a job already rendering is not.
- **Direct-to-B2 presigned uploads, upload/download hardening (section 15)**,
  **provider circuit breakers (section 16)**, **monitoring/alerting dashboards (section
  21)**, **most of the remaining required documents** (`LOAD_TEST_RESULTS.md` — no
  results exist to record; `WORKER_SCALING.md` — substantially covered by the prior
  pass's `CAPACITY_MODEL.md`; `DATABASE_PERFORMANCE.md`; `DEPLOYMENT_CHECKLIST.md`;
  `ROLLBACK_PLAN.md` — folded into `QUEUE_RECOVERY.md` §5 for this specific change
  rather than written as a generic separate document) — not attempted this pass. Each
  is either a genuinely separate, large workstream or blocked on infrastructure/owner
  decisions not yet made.

Nothing above should be read as "will be done automatically later" — each is a real gap,
listed so the next pass (or the owner) can prioritize deliberately rather than assume
completeness.
