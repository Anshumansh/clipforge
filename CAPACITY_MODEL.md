# Clipforge — Capacity Model

Written 2026-08-13, from real measurements taken during and immediately after the Phase 3
render-worker-isolation deploy. Every number in §1 was observed directly (SSH `docker stats`,
worker logs, a read-only DB query) against the live production system — none of it is
estimated. Every number in §3 (infrastructure cost) is explicitly labeled as an unverified
estimate, because I could not retrieve Hetzner's current price table this session (it's
JS-rendered; a fetch attempt returned only the marketing shell, no numbers) — do not budget
against §3 without confirming the live rate in the Hetzner console first.

**This document does not authorize any purchase or provisioning.** Per repo rule #7, that
needs the owner's explicit approval once a specific option is chosen.

---

## 1. Measured baseline (real, current production)

| Metric | Value | Source |
|---|---|---|
| Render duration (script-to-video, demo path) | 89.1s, 97.4s, 106.6s across 3 real renders (mean ≈ 97.7s) | Worker logs, live production, 2026-08-12/13 |
| Worker peak RAM (single render) | 3.34 GiB / 4 GiB limit (83%) | `docker stats` captured mid-render |
| Worker peak CPU | ~305% (roughly 3 cores) | Same capture |
| Worker idle RAM | ~230 MiB | `docker stats`, idle baseline |
| `app` (web) RAM during a render | 139.8 MiB, flat, unaffected | `docker stats`, same window as worker peak |
| Host total RAM | 7.6 GiB (Hetzner `ubuntu-8gb-hel1-1`) | OPERATIONS.md §2, confirmed via `free -h` |
| Host RAM free during a render | 2.2 GiB free / 4.2 GiB "available" | `free -h`, same window |
| Current worker concurrency | 1 (`WORKER_CONCURRENCY=1`) | docker-compose.yml, unchanged this pass |
| Current worker count | 1 (single-worker architecture only — see below) | worker/index.ts, lib/jobs/claim.ts |

**What was NOT measured** (flagged, not guessed): 1080p vs 720p difference, long-script
duration, UGC-ad workflow, repurpose with multiple clips, multiple aspect ratios in one job,
4K, voice cloning. Only the standard script-to-video demo path has real numbers. Section 7
of the original request (measure peak memory across all workflow types) is genuinely
**not done** — it requires running each workflow type once and watching `docker stats`,
which I have not done for anything but script-to-video.

## 2. Throughput math (arithmetic from §1, not a new estimate)

At a mean 97.7s/render and `WORKER_CONCURRENCY=1`:

- **One worker**: 3600s / 97.7s ≈ **36.8 jobs/hour**, before any queue overhead, retries, or
  mixed-workflow slowdown.
- This matches the brief's own back-of-envelope estimate (~40 jobs/hour) closely enough that
  I'm treating the brief's arithmetic as sound and worth using directly for planning.

**Queue-completion time for a burst of N jobs, single worker, no failures:**

| Jobs queued | Time to clear (single worker, ~97.7s/job) |
|---|---|
| 25 | ~41 minutes |
| 50 | ~81 minutes |
| 100 | ~163 minutes (≈2.7 hours) |

This is the honest number for **today's deployed system**. It is not "instant," and 100
users submitting jobs in a 5-minute burst (Scenario B) would see a queue, not simultaneous
completion — Scenario B's own text acknowledges this ("The system is not required to render
100 videos simultaneously"), so this isn't a failure state, just a capacity fact to plan
around and surface honestly to users (§25 of the brief — no promised completion times, only
measured ranges).

**To reach the brief's own target — 100 jobs in ~10 minutes** — requires enough *concurrently
active* workers that (workers × jobs/hour/worker) covers the burst inside the window:
100 jobs / (10/60 hour) = 600 jobs/hour needed ÷ 36.8 jobs/hour/worker ≈ **16.3, so 17
workers**, matching the brief's own "~15 workers" estimate (mine is slightly higher because
it uses the actual measured 97.7s mean rather than a flat 90s).

## 3. Infrastructure options (cost figures are estimates — confirm before purchasing)

The current host cannot run more than **one** full-size worker (3.34GB observed peak
comfortably fits in one 4GB-capped container, but a second identical worker container
would need another ~4GB, leaving nothing for `app`+`caddy`+OS on a 7.6GB box). Reaching
17 workers requires either many small hosts or a few large ones. I'm presenting shapes, not
committing to a vendor or exact SKU, since I could not verify live pricing this session.

| Option | Worker hosts | RAM/CPU per worker | Estimated workers | Est. throughput | Queue time: 25 / 50 / 100 jobs | Monthly cost (⚠️ unverified estimate) | Recommended? |
|---|---|---|---|---|---|---|---|
| **A — current** | 1 shared host (existing) | 4GB cap, ~1 vCPU-equivalent share | 1 | ~37/hr | 41min / 81min / 163min | Sunk cost (existing ~€15-20/mo host, per OPERATIONS.md) | Fine for today's actual traffic; not for a 100-burst target |
| **B — 4 dedicated worker hosts** | 4 separate small VPS, 8GB RAM each | 4GB cap each, 1 job at a time | 4 | ~147/hr | ~10min / 20min / 41min | ⚠️ ~4× a single 8GB host's rate — confirm exact tier price in console before budgeting | Reasonable middle ground if 10-40min queue times are acceptable |
| **C — ~17 dedicated worker hosts** | 17 separate 8GB VPS (or fewer, larger multi-slot hosts running several 4GB worker containers each, once multi-worker safety is proven — see §4 blocker) | 4GB cap each | 17 | ~625/hr | ~2.4min / 4.8min / ~10min | ⚠️ ~17× a single host's rate — likely the largest recurring cost in this whole plan, needs an explicit owner-approved number, not a guess from me | Only option that meets the brief's literal "100 jobs in ~10 minutes" target |
| **D — burst/autoscale** (scale up only during demand, scale to 1 at rest) | Hetzner API-driven autoscaling group, min 1 / max ~17 | Same 4GB/worker | Variable | Scales toward C during bursts | Same as C during a burst, near-A at rest | ⚠️ Pay-per-hour burst rate, likely cheaper monthly average than a static 17-host fleet if bursts are infrequent — needs real Hetzner burst pricing to model, not available this session | Worth serious consideration once B is proven safe, but is real new engineering work (autoscaler + safe drain-before-scale-down, per §7.8/7.9 of the brief) — not started this pass |

**Failure headroom**: none of the options above account for retries or a worker crashing
mid-render (which, per the existing atomic finalization design, safely refunds and requeues
— but that job then re-enters the queue and adds to completion time). A realistic planning
margin is +15-25% time on top of the numbers above, not included in the table.

## 4. The actual blocker to any option beyond "A"

**Running more than one worker against the same database is explicitly unsupported today.**
`lib/jobs/claim.ts`'s `reconcileAbandonedProcessingJobs()` assumes exactly one worker process
exists — a second worker starting up would incorrectly treat jobs the first worker is
legitimately still rendering as abandoned, fail them, and refund credits for jobs that were
actually still succeeding. This is documented, tested-for, and deliberate (see
`OPERATIONS.md` §12a's "single worker only" section) — not an oversight I can quietly work
around.

Options B, C, and D above are **not implementable safely until** a lease/heartbeat
mechanism is added — a `Job` table schema migration adding `leaseExpiresAt`,
`workerHeartbeatAt`, `attemptCount`, and equivalent lifecycle fields, so reconciliation can
tell "abandoned by a crash" apart from "a healthy peer is still working on it." That
migration has not been implemented this pass (see the "Owner Actions Required" thread from
the previous turn on this branch — this was explicitly deferred pending confirmation, since
it touches live credit-reservation tables).

## 5. Recommendation

Given the current real traffic level (observed: intermittent real demo usage, no evidence of
sustained 100-concurrent-user load), and given the multi-worker safety work is a real,
unstarted schema migration:

1. **Short term (no schema change, no new cost)**: stay on Option A. It already safely
   handles today's actual traffic — 22 hours of production observation showed zero credit
   inconsistencies, zero stuck jobs, and the app staying fully responsive throughout a
   worker-saturating render.
2. **Before committing to B/C/D**: implement and test the lease/heartbeat schema migration
   in a staging environment (which doesn't exist yet — also an owner decision), *then*
   re-measure real per-worker throughput with actual concurrent multi-worker load, *then*
   get a live Hetzner console quote for the chosen tier before presenting a final number.

I'm not recommending a specific paid tier from B/C/D as "the" answer, because doing so would
mean presenting a cost I could not verify as if it were confirmed — exactly what this
document is designed not to do.
