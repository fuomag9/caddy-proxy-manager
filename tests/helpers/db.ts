import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { resolve } from 'node:path';
import * as schema from '@/src/lib/db/schema';

const migrationsFolder = resolve(process.cwd(), 'drizzle');

export type TestDb = ReturnType<typeof drizzle<typeof schema>>;

/**
 * Creates a fresh in-memory SQLite database with all migrations applied.
 * Each call returns a completely isolated database instance.
 */
export function createTestDb(): TestDb {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema, casing: 'snake_case' });
  migrate(db, { migrationsFolder });
  return db;
}
