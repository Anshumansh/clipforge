# syntax=docker/dockerfile:1

FROM node:20-bookworm-slim AS base

# ---------- deps ----------
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---------- builder ----------
FROM base AS builder
WORKDIR /app

# Prisma needs OpenSSL present to detect the right query engine target at
# generate time — without it, detection silently fails and falls back to a
# broken default that doesn't match what's actually available at runtime.
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# .env isn't copied into the build context (see .dockerignore), so
# statically-rendered pages need the real site URL passed explicitly —
# otherwise metadataBase (and things derived from it, like the og:image URL)
# gets baked in as the localhost fallback.
ARG NEXTAUTH_URL
ENV NEXTAUTH_URL=${NEXTAUTH_URL}

RUN npx prisma generate
RUN npm run build

# Pre-download Remotion's headless Chrome into node_modules/.remotion so the
# first real render doesn't have to fetch ~113MB on a cold container start.
RUN npx remotion browser ensure

# ---------- runner ----------
FROM base AS runner
WORKDIR /app

# Runtime libraries headless Chrome needs (this list is the standard set used
# for Puppeteer/Playwright/Remotion in Debian-based containers).
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libatspi2.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-6 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    wget \
    xdg-utils \
    openssl \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Next.js standalone server output.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Remotion bundles its composition source at render time (not at Next.js build
# time), so the raw source needs to exist alongside the running server —
# including lib/, since remotion/*.tsx imports shared code from there.
COPY --from=builder /app/remotion ./remotion
COPY --from=builder /app/lib ./lib

# Next's dependency tracer only follows static imports, so it misses the
# platform-specific compositor binary package Remotion loads dynamically at
# runtime (e.g. @remotion/compositor-linux-x64-gnu) — copy the whole scope
# explicitly rather than guess which subpackages matter.
COPY --from=builder /app/node_modules/@remotion ./node_modules/@remotion

# Subject-tracking's face detection stack (TensorFlow.js WASM + BlazeFace +
# jpeg-js) — externalized from the webpack bundle in next.config.js, so it
# needs to exist on disk for Node's own require() at runtime, same as @remotion.
COPY --from=builder /app/node_modules/@tensorflow ./node_modules/@tensorflow
COPY --from=builder /app/node_modules/@tensorflow-models ./node_modules/@tensorflow-models
COPY --from=builder /app/node_modules/jpeg-js ./node_modules/jpeg-js

# Prisma's generated client + schema (for `prisma migrate deploy` on release).
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# The pre-downloaded headless Chrome binary from the build stage.
COPY --from=builder /app/node_modules/.remotion ./node_modules/.remotion

EXPOSE 3000
CMD ["node", "server.js"]
