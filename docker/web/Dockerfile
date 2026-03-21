# syntax=docker/dockerfile:1.6

FROM oven/bun:1-slim AS base
WORKDIR /app

FROM base AS deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY package.json bun.lock ./
# --ignore-scripts skips native addon compilation (better-sqlite3 is a test-only devDep;
# production uses bun's built-in bun:sqlite which needs no compilation)
RUN bun install --frozen-lockfile --ignore-scripts

FROM base AS builder
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATABASE_PATH=/tmp/build.db
ENV DATABASE_URL=file:/tmp/build.db
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bun run build && rm -f /tmp/build.db

FROM base AS runner
ARG PUID=10001
ARG PGID=10001

ENV NODE_ENV=production
ENV PORT=3000
WORKDIR /app

RUN (getent group ${PGID} && groupdel $(getent group ${PGID} | cut -d: -f1) || true) && \
    (getent passwd ${PUID} && userdel $(getent passwd ${PUID} | cut -d: -f1) || true) && \
    groupadd -g ${PGID} nodejs && \
    useradd -r -u ${PUID} -g nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json

COPY --from=builder --chown=nextjs:nodejs /app/.next/server/instrumentation.js ./.next/server/instrumentation.js
COPY --from=builder --chown=nextjs:nodejs /app/.next/server/instrumentation ./.next/server/instrumentation
COPY --from=builder --chown=nextjs:nodejs /app/.next/server/chunks/ ./.next/server/chunks/
COPY --from=builder --chown=nextjs:nodejs /app/drizzle ./drizzle

RUN mkdir -p /app/data && chown -R nextjs:nodejs /app/data

COPY --chown=nextjs:nodejs docker/web/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 3000
USER nextjs
ENTRYPOINT ["/entrypoint.sh"]
