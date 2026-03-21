// Vitest-only shim: maps bun:sqlite's named Database export to better-sqlite3.
// Used via resolve.alias in vitest.config.ts so tests that transitively import
// src/lib/db.ts (which uses bun:sqlite) don't fail under Node.js.
// No actual queries run via this path in the affected tests (DATABASE_URL=:memory:
// skips migrations, and the tested functions don't touch the database).
export { default as Database } from 'better-sqlite3';
