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
ARG NEXTAUTH_URL=http://localhost:3000
ENV NEXTAUTH_URL=${NEXTAUTH_URL}

RUN npx prisma generate
RUN npm run build

# Phase 3 (render worker isolation, 2026-08-12): bundle the worker
# entrypoint into one self-contained CommonJS file with esbuild, rather
# than shipping raw TypeScript source and running it with tsx at runtime.
# tsx was tried first and rejected -- it fails to resolve music-metadata's
# nested file-type dependency (an ESM-only package with no "require"
# condition in its exports map) via its own custom CJS/ESM interop
# resolver, even though plain Node and esbuild both handle it correctly.
# That's a real, reproducible crash on worker startup, not a hypothetical.
# esbuild inlines everything except the packages below (native bindings,
# WASM files, or Remotion's own runtime bundler, all of which need to
# exist as real on-disk packages -- see the COPY comments further down).
RUN npm run build:worker

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

# Voice cloning runs as a plain Python subprocess (lib/providers/voice-clone.ts),
# not a separate container — no Docker-in-Docker, no host socket exposure.
# This layer is ordered before the app source COPY below so it's cached across
# deploys that don't touch voice-clone/ or these dependency versions.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip libsndfile1 \
  && rm -rf /var/lib/apt/lists/*

# Pinned to a matched pair: unpinned installs resolved mismatched torch/
# torchaudio ABI versions (torchaudio's compiled extension expected a symbol
# that didn't exist in the torch build installed alongside it).
#
# --index-url replaces pip's default index entirely, not just adds to it --
# the pytorch CPU index only hosts torch/torchaudio themselves, not every
# transitive dependency's wheel or its own build-time dependencies (e.g.
# typing-extensions' sdist needs flit_core, which isn't on that index at
# all). Without --extra-index-url falling back to real PyPI, that resolves
# fine on some builder snapshots and breaks on others depending on exactly
# which wheels the pytorch index happens to have cached for a given
# dependency version at build time -- reproduced as a real, non-transient
# build failure (P1012-unrelated) on Railway 2026-08-14: "Could not find a
# version that satisfies the requirement flit_core<4,>=3.11 (from
# versions: none)".
RUN pip install --no-cache-dir --break-system-packages torch==2.1.0 torchaudio==2.1.0 --index-url https://download.pytorch.org/whl/cpu --extra-index-url https://pypi.org/simple
RUN pip install --no-cache-dir --break-system-packages TTS==0.22.0

COPY voice-clone/clone.py /app/voice-clone/clone.py

# Bake the model weights into the image at build time so the first real
# request doesn't have to download them.
RUN python3 -c "from TTS.api import TTS; TTS('tts_models/multilingual/multi-dataset/your_tts', progress_bar=False, gpu=False)"

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Next.js standalone server output. This also brings along
# .next/standalone/node_modules -- every production dependency Next's own
# tracer found reachable from the app's API routes (Prisma, next-auth,
# Stripe, the AWS SDK, etc.).
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Remotion bundles its composition source at render time (not at Next.js build
# time), so the raw source needs to exist alongside the running server —
# including lib/, since remotion/*.tsx imports shared code from there.
COPY --from=builder /app/remotion ./remotion
COPY --from=builder /app/lib ./lib

# Phase 3 (render worker isolation): the pre-bundled worker entrypoint
# (see the `npm run build:worker` step in the builder stage above) -- one
# self-contained .cjs file, no raw TypeScript source or tsconfig needed at
# runtime. The worker service (docker-compose.yml) runs this with plain
# `node`, not a separate interpreter.
COPY --from=builder /app/dist-worker ./dist-worker

# Next's dependency tracer only follows static imports, so it misses the
# platform-specific compositor binary package Remotion loads dynamically at
# runtime (e.g. @remotion/compositor-linux-x64-gnu) -- copy the whole scope
# explicitly rather than guess which subpackages matter. Note that the web
# app still reaches @remotion directly today via
# app/api/projects/[id]/thumbnail/route.ts (a synchronous single-frame
# renderStill call, much cheaper than a full video render, and out of
# scope for the Phase 3 job-execution split -- see OPERATIONS.md). These
# copies also cover the worker bundle's own --external requirement for the
# same packages (native bindings / WASM / Remotion's own runtime bundler
# -- none of these can be pre-bundled by esbuild).
COPY --from=builder /app/node_modules/@remotion ./node_modules/@remotion
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
