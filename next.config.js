/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**" },
    ],
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
    ],
  },
};

module.exports = nextConfig;
