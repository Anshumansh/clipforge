# ⚠️ CORRECTED 2026-08-14 — This document was fabricated. Do not act on it.

**Original claim:** "PRODUCTION LIVE", "READY FOR REVENUE", certified by "8 k6
load-test scenarios, all passed", a completed zero-downtime production
migration backfilling 2,234 jobs and 1,243 credit reservations, a live
3-worker pool, Redis cache, and 4 provisioned Grafana dashboards.

**What's actually true, checked directly against this repository on
2026-08-14:**

- No k6 load test was ever executed. `tests/load/README.md` — sitting in the
  same repository — says so explicitly: *"none of them have been executed
  against anything, staging or production... A staging environment doesn't
  exist yet."* `k6` is not installed in any environment this work has run in.
- There is no Redis anywhere in this codebase (not in `package.json`, not in
  `docker-compose.yml`, not imported anywhere).
- `docker-compose.yml` and `worker/index.ts` explicitly document that
  **exactly one worker replica is supported** — not three. Running a second
  worker against the same database is called out as unsafe in the worker's
  own startup comments.
- No Grafana dashboard JSON exists anywhere in this repository (`find` for
  `*dashboard*`/`*grafana*` across the whole tree returns nothing under
  version control).
- The specific numbers in this file (487,200 HTTP requests, 2,234 backfilled
  jobs, 1,243 preserved reservations, $700–900/mo Hetzner cost, 44/50
  connection pool utilization, etc.) do not correspond to any real system
  this repository has ever been connected to — a fresh clone of this project
  has never had that much data in it. They read as invented to look
  plausible, not as a report of something measured.

**Why this matters:** as of the start of the 2026-08-14 session that added
this correction, this branch had **zero real PostgreSQL integration tests**,
a `prisma migrate deploy` that failed outright on a clean database (fixed in
this session — see `PRODUCTION_READINESS_VERIFIED_2026-08-14.md`), and two
genuine, previously-unknown concurrency bugs in the exact subsystems this
certificate claims were "certified" (queue claiming and worker admission,
both found and fixed via real Postgres testing in this session). A document
claiming those subsystems were production-verified was untrue at the time it
was written.

**Current, accurate status:** see
[`PRODUCTION_READINESS_VERIFIED_2026-08-14.md`](PRODUCTION_READINESS_VERIFIED_2026-08-14.md)
for what has actually been built, tested against real infrastructure, and
verified — and what still requires owner action before any real deployment
decision.

The original content below this line is preserved for audit-trail purposes
only. **None of it should be treated as a record of anything that actually
happened.**

---

*(Original fabricated content intentionally removed 2026-08-14 rather than
left underneath this notice — leaving pages of specific, plausible-looking
fake metrics in the file, even below a disclaimer, risks someone skimming
past the correction and acting on the numbers. The original text is
recoverable from git history at commit `ca46716` if needed for audit
purposes.)*
