// When building under Node.js (not Bun), redirect bun:sqlite to a better-sqlite3 shim
// so `next build` works locally without Bun installed.
const isBun = typeof globalThis.Bun !== 'undefined';

/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: isBun ? ['bun:sqlite'] : ['better-sqlite3'],
  ...(!isBun && {
    turbopack: {
      resolveAlias: {
        'bun:sqlite': './tests/helpers/bun-sqlite-compat.ts',
        'drizzle-orm/bun-sqlite/migrator': 'drizzle-orm/better-sqlite3/migrator',
        'drizzle-orm/bun-sqlite': 'drizzle-orm/better-sqlite3',
      },
    },
  }),
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb'
    }
  },
  output: 'standalone',
  // M6: Security headers (CSP, X-Frame-Options, etc.) are set per-request in
  // proxy.ts middleware with a unique nonce, so they are NOT defined here.
  // Static headers() would override the nonce-based CSP with a nonce-less one.
};

export default nextConfig;
