import { describe, expect, it } from 'vitest';
import { mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { restrictDatabaseFileModes } from '@/src/lib/db';

describe('restrictDatabaseFileModes', () => {
  it('makes the database and its journal files owner-only', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cpm-db-mode-'));
    const dbPath = join(dir, 'test.db');
    for (const file of [dbPath, `${dbPath}-journal`]) writeFileSync(file, '', { mode: 0o644 });

    restrictDatabaseFileModes(dbPath);

    expect(statSync(dbPath).mode & 0o777).toBe(0o600);
    expect(statSync(`${dbPath}-journal`).mode & 0o777).toBe(0o600);
  });

  it('ignores in-memory databases and missing sidecar files', () => {
    expect(() => restrictDatabaseFileModes(':memory:')).not.toThrow();
    expect(() => restrictDatabaseFileModes(join(tmpdir(), 'does-not-exist.db'))).not.toThrow();
  });
});
