/* global process */

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
  async headers() {
    const isDev = process.env.NODE_ENV === "development";
    return [
      {
        // Applied to all routes; API routes get no-op CSP but benefit from other headers
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          // X-Frame-Options kept for legacy browsers that don't support frame-ancestors CSP directive
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              // unsafe-eval/unsafe-inline required only for Next.js HMR in development
              isDev
                ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
                : "script-src 'self' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "font-src 'self' https://fonts.gstatic.com",
              "img-src 'self' data: blob:",
              "worker-src blob:",
              "connect-src 'self'",
              "frame-ancestors 'none'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
