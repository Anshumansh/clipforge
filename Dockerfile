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
COPY --from=deps /app/node_modules ./node_modules
COPY . .

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
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Next.js standalone server output.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Remotion bundles its composition source at render time (not at Next.js build
# time), so the raw source needs to exist alongside the running server.
COPY --from=builder /app/remotion ./remotion

# Prisma's generated client + schema (for `prisma migrate deploy` on release).
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# The pre-downloaded headless Chrome binary from the build stage.
COPY --from=builder /app/node_modules/.remotion ./node_modules/.remotion

EXPOSE 3000
CMD ["node", "server.js"]
