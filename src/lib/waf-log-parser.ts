import { createReadStream, existsSync, statSync } from 'node:fs';
import { createInterface } from 'node:readline';
import maxmind, { CountryResponse } from 'maxmind';
import db from './db';
import { wafEvents, wafLogParseState } from './db/schema';
import { eq } from 'drizzle-orm';

const LOG_FILE = '/logs/waf-audit.log';
const GEOIP_DB = '/usr/share/GeoIP/GeoLite2-Country.mmdb';
const BATCH_SIZE = 200;
const RETENTION_DAYS = 90;

let geoReader: Awaited<ReturnType<typeof maxmind.open<CountryResponse>>> | null = null;
const geoCache = new Map<string, string | null>();

let stopped = false;

// ── state helpers ─────────────────────────────────────────────────────────────

function getState(key: string): string | null {
  const row = db.select({ value: wafLogParseState.value }).from(wafLogParseState).where(eq(wafLogParseState.key, key)).get();
  return row?.value ?? null;
}

function setState(key: string, value: string): void {
  db.insert(wafLogParseState).values({ key, value }).onConflictDoUpdate({ target: wafLogParseState.key, set: { value } }).run();
}

// ── GeoIP ─────────────────────────────────────────────────────────────────────

async function initGeoIP(): Promise<void> {
  if (!existsSync(GEOIP_DB)) return;
  try {
    geoReader = await maxmind.open<CountryResponse>(GEOIP_DB);
  } catch {
    // GeoIP optional
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

// ── parsing ───────────────────────────────────────────────────────────────────

interface CorazaAuditEntry {
  transaction?: {
    client_ip?: string;
    request?: {
      method?: string;
      uri?: string;
      host?: string;
    };
    timestamp?: string;
  };
  messages?: Array<{
    rule?: {
      id?: number;
      msg?: string;
    };
    severity?: string;
    data?: string;
  }>;
}

function parseLine(line: string): typeof wafEvents.$inferInsert | null {
  let entry: CorazaAuditEntry;
  try {
    entry = JSON.parse(line);
  } catch {
    return null;
  }

  const tx = entry.transaction;
  if (!tx) return null;

  const clientIp = tx.client_ip ?? '';
  if (!clientIp) return null;

  const req = tx.request ?? {};
  const ts = tx.timestamp ? Math.floor(new Date(tx.timestamp).getTime() / 1000) : Math.floor(Date.now() / 1000);

  const firstMsg = entry.messages?.[0];
  const ruleId = firstMsg?.rule?.id ?? null;
  const ruleMessage = firstMsg?.rule?.msg ?? null;
  const severity = firstMsg?.severity ?? null;

  return {
    ts,
    host: req.host ?? '',
    clientIp,
    countryCode: lookupCountry(clientIp),
    method: req.method ?? '',
    uri: req.uri ?? '',
    ruleId,
    ruleMessage,
    severity,
    rawData: line,
  };
}

async function readLines(startOffset: number): Promise<{ lines: string[]; newOffset: number }> {
  return new Promise((resolve, reject) => {
    const lines: string[] = [];
    let bytesRead = 0;

    const stream = createReadStream(LOG_FILE, { start: startOffset, encoding: 'utf8' });
    stream.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT' || err.code === 'EACCES') resolve({ lines: [], newOffset: startOffset });
      else reject(err);
    });

    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    rl.on('line', (line) => {
      bytesRead += Buffer.byteLength(line, 'utf8') + 1;
      if (line.trim()) lines.push(line.trim());
    });
    rl.on('close', () => resolve({ lines, newOffset: startOffset + bytesRead }));
    rl.on('error', reject);
  });
}

function insertBatch(rows: typeof wafEvents.$inferInsert[]): void {
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    db.insert(wafEvents).values(rows.slice(i, i + BATCH_SIZE)).run();
  }
}

function purgeOldEntries(): void {
  const cutoff = Math.floor(Date.now() / 1000) - RETENTION_DAYS * 86400;
  db.run(`DELETE FROM waf_events WHERE ts < ${cutoff}`);
}

// ── public API ────────────────────────────────────────────────────────────────

export async function initWafLogParser(): Promise<void> {
  await initGeoIP();
  console.log('[waf-log-parser] initialized');
}

export async function parseNewWafLogEntries(): Promise<void> {
  if (stopped) return;
  if (!existsSync(LOG_FILE)) return;

  try {
    const storedOffset = parseInt(getState('waf_audit_log_offset') ?? '0', 10);
    const storedSize = parseInt(getState('waf_audit_log_size') ?? '0', 10);

    let currentSize: number;
    try {
      currentSize = statSync(LOG_FILE).size;
    } catch {
      return;
    }

    // Detect log rotation
    const startOffset = currentSize < storedSize ? 0 : storedOffset;

    const { lines, newOffset } = await readLines(startOffset);

    if (lines.length > 0) {
      const rows = lines.map(parseLine).filter((r): r is typeof wafEvents.$inferInsert => r !== null);
      if (rows.length > 0) {
        insertBatch(rows);
        console.log(`[waf-log-parser] inserted ${rows.length} WAF events`);
      }
    }

    setState('waf_audit_log_offset', String(newOffset));
    setState('waf_audit_log_size', String(currentSize));

    purgeOldEntries();
  } catch (err) {
    console.error('[waf-log-parser] error during parse:', err);
  }
}

export function stopWafLogParser(): void {
  stopped = true;
}
