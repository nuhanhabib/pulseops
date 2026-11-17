# syntax=docker/dockerfile:1

# ── Dependencies ─────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
# `postinstall` runs `prisma generate`, which needs the schema but no database.
RUN npm ci

# ── Build ────────────────────────────────────────────────────────────────────
FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Baked into the security headers at build time (HSTS / upgrade-insecure-requests).
ARG APP_URL=http://localhost:3000
ENV APP_URL=$APP_URL
RUN npm run build && npm run build:worker

# ── Web: the Next.js server ──────────────────────────────────────────────────
FROM node:22-bookworm-slim AS web
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN groupadd --system --gid 1001 pulseops && useradd --system --uid 1001 --gid pulseops pulseops
COPY --from=build --chown=pulseops:pulseops /app/.next/standalone ./
COPY --from=build --chown=pulseops:pulseops /app/.next/static ./.next/static
COPY --from=build --chown=pulseops:pulseops /app/public ./public
USER pulseops
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/v1/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "server.js"]

# ── Worker: checks, incidents, notifications. Also runs migrations and the seed.
FROM node:22-bookworm-slim AS worker
WORKDIR /app
ENV NODE_ENV=production PULSEOPS_SERVICE=worker
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 1001 pulseops && useradd --system --uid 1001 --gid pulseops pulseops
COPY --from=deps --chown=pulseops:pulseops /app/node_modules ./node_modules
COPY --from=build --chown=pulseops:pulseops /app/dist ./dist
COPY --from=build --chown=pulseops:pulseops /app/prisma ./prisma
COPY --from=build --chown=pulseops:pulseops /app/prisma.config.ts /app/package.json ./
USER pulseops
CMD ["node", "dist/worker.mjs"]
