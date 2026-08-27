import * as Sentry from "@sentry/nextjs";

// Client-side error tracking. Deliberately a hardcoded literal, not
// process.env.NEXT_PUBLIC_SENTRY_DSN -- Next.js only inlines NEXT_PUBLIC_*
// vars at `next build` time, and this repo's Docker build stage never has
// .env available (see Dockerfile and the STORAGE_HOSTS comment in
// next.config.js for the exact same class of bug already hit once here).
// A DSN is meant to be public/client-embedded by Sentry's own design --
// unlike an API key, shipping it in source is the intended usage, not a
// leak. The matching CSP connect-src entry in next.config.js is what
// actually lets reports leave the browser.
const SENTRY_DSN = "https://527fcaf762596a978a6daed3fd74da99@o4511979837325312.ingest.de.sentry.io/4511979841781840";

Sentry.init({
  dsn: SENTRY_DSN,
  tracesSampleRate: 0.1,
});
