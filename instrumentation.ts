import * as Sentry from "@sentry/nextjs";

// Server + edge runtime error tracking. Unlike the client SDK (see
// instrumentation-client.ts), this genuinely can read a runtime env var --
// the server process starts fresh inside the container with .env already
// sourced, unlike `next build`'s Docker stage which never sees it (see
// Dockerfile: .env is excluded from the build context). No-ops entirely
// when SENTRY_DSN isn't set, so local dev and CI stay silent by default.
export async function register() {
  if (!process.env.SENTRY_DSN) return;

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: 0.1,
  });
}

export const onRequestError = Sentry.captureRequestError;
