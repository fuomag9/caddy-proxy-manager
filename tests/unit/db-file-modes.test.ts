import { describe, expect, it } from 'vitest';
import { chmodSync, mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { restrictDatabaseFileModes } from '@/src/lib/db';

function fileWithMode(path: string, mode: number) {
  writeFileSync(path, '');
  chmodSync(path, mode);
}

const modeOf = (path: string) => statSync(path).mode & 0o777;

describe('restrictDatabaseFileModes', () => {
  it('removes world access from the database and its journal files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cpm-db-mode-'));
    const dbPath = join(dir, 'test.db');
    fileWithMode(dbPath, 0o644);
    fileWithMode(`${dbPath}-journal`, 0o666);

    restrictDatabaseFileModes(dbPath);

    expect(modeOf(dbPath)).toBe(0o640);
    expect(modeOf(`${dbPath}-journal`)).toBe(0o660);
  });

  it('keeps owner and group bits that operators set', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cpm-db-mode-'));
    const dbPath = join(dir, 'test.db');
    fileWithMode(dbPath, 0o640);
    fileWithMode(`${dbPath}-wal`, 0o600);

    restrictDatabaseFileModes(dbPath);

    expect(modeOf(dbPath)).toBe(0o640);
    expect(modeOf(`${dbPath}-wal`)).toBe(0o600);
  });

  it('ignores in-memory databases and missing sidecar files', () => {
    expect(() => restrictDatabaseFileModes(':memory:')).not.toThrow();
    expect(() => restrictDatabaseFileModes(join(tmpdir(), 'does-not-exist.db'))).not.toThrow();
  });
});
