# E2E tests (Playwright)

Run against a real deployed environment (staging by default), not a local dev server.

```bash
npx playwright install        # first time only, downloads browser binaries
E2E_BASE_URL=https://clipforge-v2-staging.up.railway.app npm run test:e2e
```

Defaults to staging if `E2E_BASE_URL` is unset. Never point this at production
without a specific reason -- several of these tests (once the account-requiring
ones below are added) create real data.

## What's covered today

- `anonymous-journey.spec.ts` -- homepage, showcase preview playback, anonymous
  demo generation end-to-end (real render, real playback), pricing display
  vs. Stripe, and a full public-route sweep for console errors. Runs across
  desktop Chromium/Firefox/WebKit and mobile Chrome (see `playwright.config.ts`).
- `auth-validation.spec.ts` -- client-side validation, the login/password-reset
  rejection paths (and that they don't leak account existence), protected-route
  redirect behavior, and invalid/expired verification links.

## Full Business acceptance

`full-acceptance.spec.ts` is a manual, staging-only gate. It logs into the
dedicated Business account and verifies Brand Kit persistence, workspace
access, Stripe checkout and portal creation, Script, UGC, and Repurpose real
renders, MP4 downloads, timeline exports, and exact credit capture. Disposable
projects and settings are cleaned up. It intentionally spends 30 staging
credits, so it runs only when `E2E (cross-browser)` is manually dispatched with
`acceptance_mode=full`; routine pull-request runs never execute it.

## What's deliberately not covered yet

Full signup -> verify -> login and TOTP enrollment still require owner-assisted
email/authenticator confirmation. The permanent suite intentionally does not
store an authenticator seed or recovery code. Before adding that coverage:

1. Seed a test account (and, separately, a TOTP-enrolled one) on staging.
2. Add `E2E_TEST_EMAIL` / `E2E_TEST_PASSWORD` (and TOTP equivalents) to the
   env this suite reads from -- never hardcode credentials into test files.
3. Complete the user-controlled email/TOTP steps during a supervised acceptance
   session rather than placing those secrets in CI.

Stripe checkout and portal-session creation are covered in test mode by the
manual full-acceptance gate. Webhook signatures, deduplication, and credit-ledger
effects remain covered by the unit and real-PostgreSQL integration suites.
