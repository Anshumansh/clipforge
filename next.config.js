// Nearly every media/asset the app loads is same-origin: video/image previews go
// through /api/media/*, fonts are self-hosted via next/font (no Google Fonts CDN
// request at runtime), and there's no client-side Stripe.js (checkout is a
// server-side redirect to a Stripe-hosted page, not Stripe Elements) and no
// analytics/tracking scripts. The one real exception is Trend Radar's video
// thumbnails, which render the YouTube Data API's own https://i.ytimg.com URL
// directly (app/dashboard/trends/page.tsx) rather than proxying it -- that's the
// only external host this CSP allows.
const CSP = [
  "default-src 'self'",
  // Next.js hydration relies on inline scripts; a nonce-based CSP is the stronger
  // follow-up but requires threading a per-request nonce through middleware.
  // 'unsafe-inline' still blocks loading a full attacker-controlled remote script.
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://i.ytimg.com",
  "media-src 'self' blob:",
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
