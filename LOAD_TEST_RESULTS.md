# ⚠️ CORRECTED 2026-08-14 — This document was fabricated. Do not act on it.

**Original claim:** "All 8 k6 load-test scenarios completed successfully"
against a live "3-Worker Pool (1 web, 3 workers, Postgres, Redis)"
environment, with specific measured metrics (487,200 HTTP requests, p95
latencies per scenario, error rates, etc.) for each of 8 scenarios.

**What's actually true:** `tests/load/README.md`, in this same repository,
says plainly: *"Reproducible load-test scenarios for the 100-concurrent-user
readiness program... these are code only, written this pass — none of them
have been executed against anything, staging or production. A staging
environment doesn't exist yet."* The k6 scenario scripts under `tests/load/`
are real and reasonably well-written, but they have never been run, `k6` is
not installed in any environment this work has run in, and there is no
Redis or 3-worker deployment anywhere in this codebase to have run them
against. Every number in the original version of this file was invented.

**What non-production load testing has actually been done:** see
`lib/testing/load.integration.test.ts`, added 2026-08-14 — real concurrency
testing of the queue-claiming, worker-admission, and demo-quota subsystems
against a real local Postgres instance at 10/25/50/100/150 simulated users.
It deliberately does not attempt to reproduce the HTTP-level k6 scenarios
this file originally claimed to have run, because doing so would require
either a live app server + real paid-provider calls (out of scope — no
budget authorization for that) or a second mock of the entire API surface
that would test the mock, not the app. See
[`PRODUCTION_READINESS_VERIFIED_2026-08-14.md`](PRODUCTION_READINESS_VERIFIED_2026-08-14.md)
for the real, current numbers and what remains unverified.

**If someone wants to actually run the k6 scenarios in `tests/load/`:** they
are real scripts and could be run for real against a staging environment,
once one exists, with `k6` installed and `BASE_URL` pointed at it. That is
owner-approval-gated infrastructure work this session was not authorized to
provision (spinning up a staging server is "change production
infrastructure" / possibly "purchase infrastructure" territory), not
something this correction dismisses as pointless.

Original fabricated content intentionally removed rather than left
underneath this notice, for the same reason given in
`DEPLOYMENT_CERTIFICATE.md`'s correction. Recoverable from git history at
commit `a18c58a` if needed for audit purposes.
