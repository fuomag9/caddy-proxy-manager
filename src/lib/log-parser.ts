import { createReadStream, existsSync, statSync } from 'node:fs';
import maxmind, { CountryResponse } from 'maxmind';
import db from './db';
import { logParseState } from './db/schema';
import { eq } from 'drizzle-orm';
import { insertTrafficEvents, type TrafficEventRow } from './clickhouse/client';

const LOG_FILE = '/logs/access.log';
const GEOIP_DB = '/usr/share/GeoIP/GeoLite2-Country.mmdb';
const BATCH_SIZE = 500;

// GeoIP reader — null if mmdb not available
let geoReader: Awaited<ReturnType<typeof maxmind.open<CountryResponse>>> | null = null;
const geoCache = new Map<string, string | null>();

let stopped = false;

// ── state helpers ────────────────────────────────────────────────────────────

function getState(key: string): string | null {
  const row = db.select({ value: logParseState.value }).from(logParseState).where(eq(logParseState.key, key)).get();
  return row?.value ?? null;
}

function setState(key: string, value: string): void {
  db.insert(logParseState).values({ key, value }).onConflictDoUpdate({ target: logParseState.key, set: { value } }).run();
}

// ── GeoIP ────────────────────────────────────────────────────────────────────

async function initGeoIP(): Promise<void> {
  if (!existsSync(GEOIP_DB)) {
    console.log('[log-parser] GeoIP database not found, country codes will be null');
    return;
  }
  try {
    geoReader = await maxmind.open<CountryResponse>(GEOIP_DB);
    console.log('[log-parser] GeoIP database loaded');
  } catch (err) {
    console.warn('[log-parser] Failed to load GeoIP database:', err);
  }
}

function lookupCountry(ip: string): string | null {
  if (!geoReader) return null;
  if (geoCache.has(ip)) return geoCache.get(ip)!;
  if (geoCache.size > 10_000) geoCache.clear();
  try {
    const result = geoReader.get(ip);
    const code = result?.country?.iso_code ?? null;
    geoCache.set(ip, code);
    return code;
  } catch {
    geoCache.set(ip, null);
    return null;
  }
}

// ── log parsing ──────────────────────────────────────────────────────────────

interface CaddyLogEntry {
  ts?: number;
  msg?: string;
  plugin?: string;
  // fields on "request blocked" entries (top-level)
  client_ip?: string;
  method?: string;
  uri?: string;
  // fields on "handled request" entries
  status?: number;
  size?: number;
  request?: {
    client_ip?: string;
    remote_ip?: string;
    host?: string;
    method?: string;
    uri?: string;
    proto?: string;
    headers?: Record<string, string[]>;
  };
}

type BlockedSignatures = Set<string> | Map<string, number>;

function consumeBlockedSignature(blocked: BlockedSignatures, key: string): boolean {
  if (blocked instanceof Map) {
    const count = blocked.get(key) ?? 0;
    if (count <= 0) return false;
    if (count === 1) blocked.delete(key);
    else blocked.set(key, count - 1);
    return true;
  }
  return blocked.has(key);
}

// How long an unmatched "request blocked" signature is carried across parse
// passes while waiting for its paired "handled request" row to be written.
const BLOCKED_CARRYOVER_WINDOW_SEC = 120;

// Signatures collected in one pass but not yet matched to a "handled request"
// row. caddy-blocker logs "request blocked" immediately before Caddy logs the
// "handled request", so a parse-tick boundary can fall between the two lines.
// Carrying the unmatched signatures forward lets the next pass mark them.
let pendingBlocked: Map<string, number> = new Map();

// Build counted signatures from caddy-blocker's "request blocked" entries so we
// can mark the corresponding "handled request" rows correctly instead of using
// status === 403 (which would also catch legitimate upstream 403s). Pass an
// existing map via `into` to merge new signatures onto carried-over ones.
export function collectBlockedSignatures(lines: string[], into?: Map<string, number>): Map<string, number> {
  const blocked = into ?? new Map<string, number>();
  for (const line of lines) {
    let entry: CaddyLogEntry;
    try { entry = JSON.parse(line.trim()); } catch { continue; }
    if (entry.msg !== 'request blocked' || entry.plugin !== 'caddy-blocker') continue;
    const ts = Math.floor(entry.ts ?? 0);
    const key = `${ts}|${entry.client_ip ?? ''}|${entry.method ?? ''}|${entry.uri ?? ''}`;
    blocked.set(key, (blocked.get(key) ?? 0) + 1);
  }
  return blocked;
}

// Drop carried-over signatures older than the carry-over window so the pending
// map can't grow unbounded when a "request blocked" line never gets a paired
// "handled request" row. The timestamp is the first field of the key.
export function pruneBlockedSignatures(blocked: Map<string, number>, refTs: number): Map<string, number> {
  const cutoff = refTs - BLOCKED_CARRYOVER_WINDOW_SEC;
  for (const [key, count] of blocked) {
    if (count <= 0) { blocked.delete(key); continue; }
    const ts = Number(key.slice(0, key.indexOf('|')));
    if (Number.isFinite(ts) && ts < cutoff) blocked.delete(key);
  }
  return blocked;
}

export function parseLine(line: string, blocked: BlockedSignatures): TrafficEventRow | null {
  let entry: CaddyLogEntry;
  try {
    entry = JSON.parse(line);
  } catch {
    return null;
  }

  // Only process "handled request" log entries
  if (entry.msg !== 'handled request') return null;

  const req = entry.request ?? {};
  const clientIp = req.client_ip || req.remote_ip || '';
  const ts = Math.floor(entry.ts ?? Date.now() / 1000);
  const method = req.method ?? '';
  const uri = req.uri ?? '';
  const status = entry.status ?? 0;

  const key = `${ts}|${clientIp}|${method}|${uri}`;

  return {
    ts,
    client_ip: clientIp,
    country_code: clientIp ? lookupCountry(clientIp) : null,
    host: req.host ?? '',
    method,
    uri,
    status,
    proto: req.proto ?? '',
    bytes_sent: entry.size ?? 0,
    user_agent: req.headers?.['User-Agent']?.[0] ?? '',
    is_blocked: consumeBlockedSignature(blocked, key),
  };
}

// Read complete (newline-terminated) lines starting at `startOffset`. The
// offset only advances past the last newline, so a line still being written
// when we read (the file ends mid-line) is left intact and re-read next pass
// instead of being split into invalid fragments and lost.
export async function readLines(startOffset: number, file: string = LOG_FILE): Promise<{ lines: string[]; newOffset: number }> {
  return new Promise((resolve, reject) => {
    const lines: string[] = [];
    let totalBytes = 0;        // all bytes read from startOffset to EOF
    let pending: Buffer = Buffer.alloc(0); // bytes after the last newline (incomplete line)

    const stream = createReadStream(file, { start: startOffset });
    stream.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT' || err.code === 'EACCES') resolve({ lines: [], newOffset: startOffset });
      else reject(err);
    });
    stream.on('data', (chunk: Buffer) => {
      totalBytes += chunk.length;
      let buf = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      let start = 0;
      let nl: number;
      while ((nl = buf.indexOf(0x0a, start)) !== -1) {
        const line = buf.subarray(start, nl).toString('utf8').trim();
        if (line) lines.push(line);
        start = nl + 1;
      }
      pending = start === 0 ? buf : buf.subarray(start);
    });
    // Complete bytes = everything except the trailing incomplete line.
    stream.on('end', () => resolve({ lines, newOffset: startOffset + totalBytes - pending.length }));
  });
}

async function insertBatch(rows: TrafficEventRow[]): Promise<void> {
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    await insertTrafficEvents(rows.slice(i, i + BATCH_SIZE));
  }
}

// ── public API ───────────────────────────────────────────────────────────────

export async function initLogParser(): Promise<void> {
  await initGeoIP();
  console.log('[log-parser] initialized');
}

export async function parseNewLogEntries(): Promise<void> {
  if (stopped) return;
  if (!existsSync(LOG_FILE)) return;

  try {
    const storedOffset = parseInt(getState('access_log_offset') ?? '0', 10);
    const storedSize = parseInt(getState('access_log_size') ?? '0', 10);

    let currentSize: number;
    try {
      currentSize = statSync(LOG_FILE).size;
    } catch {
      return;
    }

    // Detect log rotation: file shrank
    const startOffset = currentSize < storedSize ? 0 : storedOffset;

    const { lines, newOffset } = await readLines(startOffset);

    if (lines.length > 0) {
      // Merge any signatures carried over from the previous pass (a "request
      // blocked" line whose "handled request" row hadn't been written yet).
      const blocked = collectBlockedSignatures(lines, pendingBlocked);
      const rows = lines.map(l => parseLine(l, blocked)).filter(r => r !== null);
      await insertBatch(rows);
      // Whatever signatures weren't consumed are unmatched blocks; carry the
      // recent ones forward and drop stale ones so the map can't grow forever.
      const latestTs = rows.length ? Math.max(...rows.map(r => r.ts)) : Math.floor(Date.now() / 1000);
      pendingBlocked = pruneBlockedSignatures(blocked, latestTs);
      const blockedRows = rows.reduce((n, r) => n + (r.is_blocked ? 1 : 0), 0);
      console.log(`[log-parser] inserted ${rows.length} traffic events (${blockedRows} blocked)`);
    }

    setState('access_log_offset', String(newOffset));
    setState('access_log_size', String(currentSize));
  } catch (err) {
    console.error('[log-parser] error during parse:', err);
  }
}

export function stopLogParser(): void {
  stopped = true;
}
