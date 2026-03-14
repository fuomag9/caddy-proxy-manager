import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve as resolvePath } from "node:path";
import * as schema from "./db/schema";

const DEFAULT_SQLITE_URL = "file:./data/caddy-proxy-manager.db";

type GlobalForDrizzle = typeof globalThis & {
  __DRIZZLE_DB__?: ReturnType<typeof drizzle<typeof schema>>;
  __SQLITE_CLIENT__?: Database.Database;
  __MIGRATIONS_RAN__?: boolean;
};

function resolveSqlitePath(rawUrl: string): string {
  if (!rawUrl) {
    return ":memory:";
  }
  if (rawUrl === ":memory:" || rawUrl === "file::memory:") {
    return ":memory:";
  }

  if (rawUrl.startsWith("file:./") || rawUrl.startsWith("file:../")) {
    const relative = rawUrl.slice("file:".length);
    return resolvePath(process.cwd(), relative);
  }

  if (rawUrl.startsWith("file:")) {
    try {
      const fileUrl = new URL(rawUrl);
      if (fileUrl.host && fileUrl.host !== "localhost") {
        throw new Error("Remote SQLite hosts are not supported.");
      }
      return decodeURIComponent(fileUrl.pathname);
    } catch {
      const remainder = rawUrl.slice("file:".length);
      if (!remainder) {
        return ":memory:";
      }
      return isAbsolute(remainder) ? remainder : resolvePath(process.cwd(), remainder);
    }
  }

  return isAbsolute(rawUrl) ? rawUrl : resolvePath(process.cwd(), rawUrl);
}

const databaseUrl = process.env.DATABASE_URL ?? DEFAULT_SQLITE_URL;
const sqlitePath = resolveSqlitePath(databaseUrl);

function ensureDirectoryFor(pathname: string) {
  if (pathname === ":memory:") {
    return;
  }
  const dir = dirname(pathname);
  mkdirSync(dir, { recursive: true });
}

const globalForDrizzle = globalThis as GlobalForDrizzle;

const sqlite =
  globalForDrizzle.__SQLITE_CLIENT__ ??
  (() => {
    ensureDirectoryFor(sqlitePath);
    return new Database(sqlitePath);
  })();

if (process.env.NODE_ENV !== "production") {
  globalForDrizzle.__SQLITE_CLIENT__ = sqlite;
}

export const db =
  globalForDrizzle.__DRIZZLE_DB__ ?? drizzle(sqlite, { schema, casing: "snake_case" });

if (process.env.NODE_ENV !== "production") {
  globalForDrizzle.__DRIZZLE_DB__ = db;
}

const migrationsFolder = resolvePath(process.cwd(), "drizzle");

function runMigrations() {
  if (sqlitePath === ":memory:") {
    return;
  }
  if (globalForDrizzle.__MIGRATIONS_RAN__) {
    return;
  }
  try {
    migrate(db, { migrationsFolder });
    globalForDrizzle.__MIGRATIONS_RAN__ = true;
  } catch (error: unknown) {
    // During build, pages may be pre-rendered in parallel, causing race conditions
    // with migrations. If tables already exist, just continue.
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      "message" in error &&
      error.code === "SQLITE_ERROR" &&
      typeof error.message === "string" &&
      error.message.includes("already exists")
    ) {
      console.log('Database tables already exist, skipping migrations');
      globalForDrizzle.__MIGRATIONS_RAN__ = true;
      return;
    }
    throw error;
  }
}

try {
  runMigrations();
} catch (error) {
  console.error("Failed to run database migrations:", error);
  // In build mode, allow the build to continue even if migrations fail
  // The runtime initialization will handle migrations properly
  if (process.env.NODE_ENV !== 'production' || process.env.NEXT_PHASE === 'phase-production-build') {
    console.warn('Continuing despite migration error during build phase');
  } else {
    throw error;
  }
}

export { schema };
export default db;

export function nowIso(): string {
  return new Date().toISOString();
}

export function toIso(value: string | Date | null | undefined): string | null {
  if (!value) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
