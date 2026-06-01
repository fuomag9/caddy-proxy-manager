import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Mock only the heavy deps; node:fs stays REAL so we exercise the actual file
// reading / offset behaviour of readLines.
vi.mock('@/src/lib/db', () => ({
  default: {
    select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ get: vi.fn().mockReturnValue(null) }) }) }),
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue({ onConflictDoUpdate: vi.fn().mockReturnValue({ run: vi.fn() }) }) }),
  },
}));
vi.mock('maxmind', () => ({ default: { open: vi.fn().mockResolvedValue(null) } }));
vi.mock('@/src/lib/clickhouse/client', () => ({ insertTrafficEvents: vi.fn().mockResolvedValue(undefined) }));

import { readLines } from '@/src/lib/log-parser';

describe('readLines (real filesystem)', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'logparser-'));
    file = join(dir, 'access.log');
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns complete lines and advances offset to their byte length', async () => {
    const content = 'line-one\nline-two\n';
    writeFileSync(file, content);
    const { lines, newOffset } = await readLines(0, file);
    expect(lines).toEqual(['line-one', 'line-two']);
    expect(newOffset).toBe(Buffer.byteLength(content));
  });

  it('does NOT emit or advance past an incomplete final line (no trailing newline)', async () => {
    const content = 'complete\nincomplete-tail';
    writeFileSync(file, content);
    const { lines, newOffset } = await readLines(0, file);
    // Only the newline-terminated line is returned...
    expect(lines).toEqual(['complete']);
    // ...and the offset stops right after that newline, so the partial tail
    // will be re-read whole next pass instead of being split and lost.
    expect(newOffset).toBe(Buffer.byteLength('complete\n'));
  });

  it('reconstructs a line that was split across two reads (the partial-line bug)', async () => {
    // Pass 1: a line is still being written (no trailing newline yet).
    writeFileSync(file, '{"a":1}\n{"b":2');
    const pass1 = await readLines(0, file);
    expect(pass1.lines).toEqual(['{"a":1}']);

    // Pass 2: the rest of the line lands; reading from the carried offset must
    // yield the FULL second line, not a corrupted fragment.
    appendFileSync(file, ',"c":3}\n');
    const pass2 = await readLines(pass1.newOffset, file);
    expect(pass2.lines).toEqual(['{"b":2,"c":3}']);
    expect(pass2.newOffset).toBe(Buffer.byteLength('{"a":1}\n{"b":2,"c":3}\n'));
  });

  it('handles multi-byte UTF-8 without corruption', async () => {
    const content = '{"city":"München"}\n{"city":"東京"}\n';
    writeFileSync(file, content);
    const { lines, newOffset } = await readLines(0, file);
    expect(lines).toEqual(['{"city":"München"}', '{"city":"東京"}']);
    expect(newOffset).toBe(Buffer.byteLength(content));
  });

  it('returns no lines and a stable offset when nothing is newline-terminated yet', async () => {
    writeFileSync(file, 'still-writing');
    const { lines, newOffset } = await readLines(0, file);
    expect(lines).toEqual([]);
    expect(newOffset).toBe(0);
  });

  it('returns the startOffset unchanged for a missing file', async () => {
    const { lines, newOffset } = await readLines(0, join(dir, 'does-not-exist.log'));
    expect(lines).toEqual([]);
    expect(newOffset).toBe(0);
  });
});
