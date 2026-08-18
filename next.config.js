// Nearly every media/asset the app loads is nominally same-origin: video/image
// previews are requested from /api/media/*, fonts are self-hosted via next/font
// (no Google Fonts CDN request at runtime), and there's no client-side Stripe.js
// (checkout is a server-side redirect to a Stripe-hosted page, not Stripe
// Elements) and no analytics/tracking scripts.
//
// /api/media/* itself is a 307 redirect to a short-lived presigned URL on the
// storage provider (see app/api/media/[...key]/route.ts) -- it never proxies the
// bytes. CSP source matching applies to the resource actually fetched, so the
// storage host has to be allowed directly here too, or every video/thumbnail
// site-wide silently fails to load despite the redirecting route returning a
// clean 307. Hardcoded (not derived from STORAGE_ENDPOINT) because next.config.js's
// headers() runs once during `next build`, which happens in the Docker builder
// stage before STORAGE_* runtime env vars are ever injected -- an env-derived
// value here would read as undefined and silently ship the old, broken CSP.
// The other real exception is Trend Radar's video thumbnails, which render the
// YouTube Data API's own https://i.ytimg.com URL directly (app/dashboard/trends/
// page.tsx) rather than proxying it.
//
// Listed, not a single value, because different environments use different
// S3-compatible providers against this same built image: production's real
// bucket is Backblaze B2; Railway's own bucket product (used on staging as of
// 2026-08-18) presigns against *.storageapi.dev instead. Reproduced live: every
// video/thumbnail silently failed to load on staging with a CSP media-src/
// img-src violation in the console until this host was added -- the presigned
// redirect itself returned a clean 307, so nothing server-side pointed at it.
const STORAGE_HOSTS = ["https://s3.us-west-004.backblazeb2.com", "https://*.storageapi.dev"];
const STORAGE_HOST = STORAGE_HOSTS.join(" ");

const CSP = [
  "default-src 'self'",
  // Next.js hydration relies on inline scripts; a nonce-based CSP is the stronger
  // follow-up but requires threading a per-request nonce through middleware.
  // 'unsafe-inline' still blocks loading a full attacker-controlled remote script.
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: https://i.ytimg.com ${STORAGE_HOST}`,
  `media-src 'self' blob: ${STORAGE_HOST}`,
  "font-src 'self'",
  "connect-src 'self'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: CSP },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**" },
    ],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  experimental: {
    serverComponentsExternalPackages: [
      "@remotion/bundler",
      "@remotion/renderer",
      "@remotion/cli",
      "remotion",
      "esbuild",
      "msedge-tts",
      "ws",
      "@tensorflow/tfjs-core",
      "@tensorflow/tfjs-converter",
      "@tensorflow/tfjs-backend-wasm",
      "@tensorflow-models/blazeface",
      "jpeg-js",
    ],
  },
};

module.exports = nextConfig;
