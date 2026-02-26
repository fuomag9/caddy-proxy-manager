import { createReadStream, existsSync, statSync } from 'node:fs';
import { createInterface } from 'node:readline';
import maxmind, { CountryResponse } from 'maxmind';
import db from './db';
import { trafficEvents, logParseState } from './db/schema';
import { eq } from 'drizzle-orm';

const LOG_FILE = '/logs/access.log';
const GEOIP_DB = '/usr/share/GeoIP/GeoLite2-Country.mmdb';
const BATCH_SIZE = 500;
const RETENTION_DAYS = 90;

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

function parseLine(line: string): typeof trafficEvents.$inferInsert | null {
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
  const status = entry.status ?? 0;

  return {
    ts: Math.floor(entry.ts ?? Date.now() / 1000),
    clientIp,
    countryCode: clientIp ? lookupCountry(clientIp) : null,
    host: req.host ?? '',
    method: req.method ?? '',
    uri: req.uri ?? '',
    status,
    proto: req.proto ?? '',
    bytesSent: entry.size ?? 0,
    userAgent: req.headers?.['User-Agent']?.[0] ?? '',
    isBlocked: status === 403,
  };
}

async function readLines(startOffset: number): Promise<{ rows: typeof trafficEvents.$inferInsert[]; newOffset: number }> {
  return new Promise((resolve, reject) => {
    const rows: typeof trafficEvents.$inferInsert[] = [];
    let bytesRead = 0;

    const stream = createReadStream(LOG_FILE, { start: startOffset, encoding: 'utf8' });
    stream.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') resolve({ rows: [], newOffset: startOffset });
      else reject(err);
    });

    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    rl.on('line', (line) => {
      bytesRead += Buffer.byteLength(line, 'utf8') + 1; // +1 for newline
      const row = parseLine(line.trim());
      if (row) rows.push(row);
    });
    rl.on('close', () => resolve({ rows, newOffset: startOffset + bytesRead }));
    rl.on('error', reject);
  });
}

function insertBatch(rows: typeof trafficEvents.$inferInsert[]): void {
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    db.insert(trafficEvents).values(rows.slice(i, i + BATCH_SIZE)).run();
  }
}

function purgeOldEntries(): void {
  const cutoff = Math.floor(Date.now() / 1000) - RETENTION_DAYS * 86400;
  db.delete(trafficEvents).where(eq(trafficEvents.ts, cutoff)).run();
  // Use raw sql for < comparison
  db.run(`DELETE FROM traffic_events WHERE ts < ${cutoff}`);
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

    const { rows, newOffset } = await readLines(startOffset);

    if (rows.length > 0) {
      insertBatch(rows);
      console.log(`[log-parser] inserted ${rows.length} traffic events`);
    }

    setState('access_log_offset', String(newOffset));
    setState('access_log_size', String(currentSize));

    // Purge old entries once per run (cheap since it's indexed)
    purgeOldEntries();
  } catch (err) {
    console.error('[log-parser] error during parse:', err);
  }
}

export function stopLogParser(): void {
  stopped = true;
}
