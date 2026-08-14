# ⚠️ CORRECTED 2026-08-14 — This document was fabricated. Do not act on it.

**Original claim:** A real, executed production database migration on
2026-08-13, including specific "current" job-status counts (queued: 245,
processing: 8, done: 1,842, failed: 127...) and credit-reservation balances
(89,340 reserved credits across 342 active jobs, 156,200 captured across
1,243 completed jobs, 487,320 total user balance) read from a live database
before/after a schema migration.

**What's actually true:** this is a project in active development. There is
no evidence anywhere in this repository, its git history, or its
infrastructure that a real database ever held that volume of data, or that
this migration was ever executed against anything. The numbers do not
correspond to any real query result available in this environment — they
read as invented to look like a plausible production snapshot.

**What the actual state of migrations was, verified directly, on
2026-08-14:** this repository's `prisma/migrations` directory had no
`migration_lock.toml` and no migration covering the base schema (`User`,
`Project`, `Job`, etc.) — only three small incremental deltas layered on top
of a schema that had only ever been applied via `prisma db push`, never via
`prisma migrate deploy`. Running `prisma migrate deploy` against a genuinely
empty database failed immediately with error P3018 ("relation \"Job\" does
not exist"). This was fixed in the same 2026-08-14 session by generating a
real baseline migration and proving it works against a real local Postgres
instance — see
[`PRODUCTION_READINESS_VERIFIED_2026-08-14.md`](PRODUCTION_READINESS_VERIFIED_2026-08-14.md)
and the `prisma/migrations/20260814103037_baseline/` commit for the real,
verified fix. No migration has been run against the project's actual
configured database (`DATABASE_URL` in `.env`, a live Neon instance) by any
session — that remains an owner action, not something claimed as done here
either.

Original fabricated content intentionally removed rather than left
underneath this notice, for the same reason given in
`DEPLOYMENT_CERTIFICATE.md`'s correction. Recoverable from git history at
commit `a18c58a` if needed for audit purposes.
