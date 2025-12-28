# syntax=docker/dockerfile:1.6

FROM node:25-slim AS base
WORKDIR /app

FROM base AS deps
# Install build dependencies for native modules like better-sqlite3
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    openssl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
# Install dependencies
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

FROM base AS builder
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Set a temporary database path for build
ENV DATABASE_PATH=/tmp/build.db
ENV DATABASE_URL=file:/tmp/build.db
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Build the Next.js application
RUN npm run build && rm -f /tmp/build.db

FROM base AS runner
# Accept build args for user/group IDs to support rootless operation
# Using 10001 as default to avoid conflicts with system users
ARG PUID=10001
ARG PGID=10001

ENV NODE_ENV=production
ENV PORT=3000
WORKDIR /app

# Create user and group with configurable IDs for rootless operation
# Remove any existing users/groups with the same UID/GID to avoid conflicts
RUN (getent group ${PGID} && groupdel $(getent group ${PGID} | cut -d: -f1) || true) && \
    (getent passwd ${PUID} && userdel $(getent passwd ${PUID} | cut -d: -f1) || true) && \
    groupadd -g ${PGID} nodejs && \
    useradd -r -u ${PUID} -g nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json

# Copy instrumentation file and all required chunks for server startup initialization
COPY --from=builder --chown=nextjs:nodejs /app/.next/server/instrumentation.js ./.next/server/instrumentation.js
COPY --from=builder --chown=nextjs:nodejs /app/.next/server/instrumentation ./.next/server/instrumentation
COPY --from=builder --chown=nextjs:nodejs /app/.next/server/chunks/ ./.next/server/chunks/
# Copy Drizzle migrations for runtime schema management
COPY --from=builder --chown=nextjs:nodejs /app/drizzle ./drizzle

# Create data directory for SQLite database with correct ownership
RUN mkdir -p /app/data && chown -R nextjs:nodejs /app/data

# Copy entrypoint script
COPY --chown=nextjs:nodejs docker/web/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 3000

# Run as non-root user (fully rootless)
USER nextjs

ENTRYPOINT ["/entrypoint.sh"]
