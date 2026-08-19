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

## What's deliberately not covered yet

Full signup -> verify -> login -> session -> TOTP -> generate -> billing
coverage needs a real seeded test account (and, for TOTP, a seeded secret).
This suite intentionally does not create that account itself. Before adding
that coverage:

1. Seed a test account (and, separately, a TOTP-enrolled one) on staging.
2. Add `E2E_TEST_EMAIL` / `E2E_TEST_PASSWORD` (and TOTP equivalents) to the
   env this suite reads from -- never hardcode credentials into test files.
3. Extend this directory with `authenticated-journey.spec.ts` following the
   same real-render, real-assertion pattern as the anonymous suite.

Stripe checkout/webhook coverage additionally needs staging to have test-mode
Stripe keys configured (it currently has none -- production's keys are live
mode, so checkout flows can't be safely tested against either environment
right now).
