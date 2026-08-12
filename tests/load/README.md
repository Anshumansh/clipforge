# Clipforge load tests (k6)

Reproducible load-test scenarios for the 100-concurrent-user readiness program
(scale/100-user-readiness branch). These are **code only, written this pass —
none of them have been executed against anything, staging or production**. A
staging environment doesn't exist yet; running these against production
without explicit owner approval is against repo rules.

## Requirements

- [k6](https://k6.io/docs/get-started/installation/) installed locally or in CI.
- Run from a **separate machine** with at least 20% unused capacity, so the
  load generator itself never becomes the bottleneck being measured.
- Seeded, isolated test accounts — never real customer accounts. Clean them
  up after each run (see each script's teardown notes).

## Environment variables

| Variable | Used by | Purpose |
|---|---|---|
| `BASE_URL` | all scripts | Target origin, e.g. `https://staging.forgecut.app` — never point this at `https://forgecut.app` without separate explicit approval |
| `TEST_USER_EMAIL` / `TEST_USER_PASSWORD` | `authenticated-dashboard.js`, `generation-burst.js`, `mixed-load.js` | A seeded test account's credentials. Must be a routable, owner-controlled address per repo rules — never a fake `@example.com` login for an authenticated flow, since these scripts exercise real credit reservations |

## Running

```bash
k6 run -e BASE_URL=https://staging.example.com tests/load/public-browsing.js
```

## Scenarios (section 19 of the scale-readiness brief)

| File | Scenario | Users | Duration |
|---|---|---|---|
| `public-browsing.js` | Homepage, pricing, examples, other public pages | 100 | 30 min soak |
| `authenticated-dashboard.js` | Project list, job list, account, status checks | 100 | 10 min |
| `generation-burst.js` | 100 users submit a generation request each | 100 | 5 min |
| `mixed-load.js` | Browsing + active polling + worker rendering + new submissions together | 100 browsing + 20 polling | 15 min |
| `spike-recovery.js` | Ramp to 150 for 2 min, then back to normal, verify recovery | 100 → 150 → 100 | ~10 min |

## CI usage

Per section 22: **do not** run the full 100-user suite on every commit. A
short smoke variant (10 users, 1 minute) is appropriate for CI; the complete
suite belongs in a pre-release gate only, against a real staging target, with
explicit owner sign-off to run it. No CI wiring for either has been added
this pass — these scripts exist, but nothing currently invokes them
automatically.

## What "pass" means

Each script defines its own k6 `thresholds` matching the specific targets
from the brief (p95 latencies, error rate < 1%, etc.) — k6 itself will report
pass/fail against those at the end of a run. A script exiting cleanly is not
the same as its thresholds passing; check the summary output.
