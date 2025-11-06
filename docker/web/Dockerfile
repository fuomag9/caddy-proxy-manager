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
# Set Prisma to download engines during install and ignore checksum errors
ENV PRISMA_CLI_BINARY_TARGETS=native,debian-openssl-3.0.x
ENV PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
# Explicitly generate Prisma client with engines during deps stage
COPY prisma ./prisma
RUN npx prisma generate

FROM base AS builder
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Set a temporary database path for build
ENV DATABASE_PATH=/tmp/build.db
ENV DATABASE_URL=file:/tmp/build.db
# Skip Prisma engine checksum validation and downloads (engines already bundled from deps stage)
ENV PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1
ENV PRISMA_SKIP_POSTINSTALL_GENERATE=1
# Install openssl for Prisma query engine
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Build the application (prisma client already generated in deps stage with engines)
RUN npx prisma db push --skip-generate
RUN npm run build && rm -f /tmp/build.db

FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000
WORKDIR /app

# Install gosu for privilege dropping and openssl for Prisma
RUN apt-get update && apt-get install -y --no-install-recommends \
    gosu \
    openssl \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd -g 1001 nodejs && useradd -r -u 1001 -g nodejs nextjs

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/package.json ./package.json

# Copy instrumentation file and all required chunks for server startup initialization
COPY --from=builder /app/.next/server/instrumentation.js ./.next/server/instrumentation.js
COPY --from=builder /app/.next/server/instrumentation ./.next/server/instrumentation
COPY --from=builder /app/.next/server/chunks/ ./.next/server/chunks/

# Copy Prisma client
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/prisma ./prisma

# Create data directory for SQLite database
RUN mkdir -p /app/data && chown -R nextjs:nodejs /app/data

# Copy entrypoint script
COPY docker/web/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 3000

# Run as root so entrypoint can fix permissions, then switch to nextjs
ENTRYPOINT ["/entrypoint.sh"]
