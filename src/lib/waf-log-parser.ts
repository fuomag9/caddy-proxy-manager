import { existsSync, statSync, truncateSync } from 'node:fs';
import maxmind, { CountryResponse } from 'maxmind';
import db from './db';
import { wafLogParseState } from './db/schema';
import { eq } from 'drizzle-orm';
import { insertWafEvents, type WafEventRow } from './clickhouse/client';
import { readLines } from './log-read';

const AUDIT_LOG = '/logs/waf-audit.log';
const RULES_LOG = '/logs/waf-rules.log';
const GEOIP_DB = '/usr/share/GeoIP/GeoLite2-Country.mmdb';
const BATCH_SIZE = 200;
// Coraza's SecAuditLog writes directly to AUDIT_LOG with no rotation of its
// own (unlike access.log/waf-rules.log, which go through Caddy's file writer
// and roll automatically). Once fully ingested, truncate it in place past
// this size so it can't grow unbounded and fill the disk.
const AUDIT_LOG_TRUNCATE_THRESHOLD = 100 * 1024 * 1024;

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

// ── WAF rules log parsing ─────────────────────────────────────────────────────
// Caddy's http.handlers.waf logger emits a JSON line per matched rule containing
// the ModSecurity-format message string, e.g.:
//   [id "941100"] [msg "XSS Attack ..."] [severity "critical"] [unique_id "abc123"]
// We parse these to build a map of unique_id → first matched rule info.

interface RuleInfo {
  ruleId: number | null;
  ruleMessage: string | null;
  severity: string | null;
}

export function extractBracketField(msg: string, field: string): string | null {
  const m = msg.match(new RegExp(`\\[${field} "([^"]*)"\\]`));
  return m ? m[1] : null;
}

// Anomaly-evaluation rules are not specific attacks — they only report the
// accumulated score, so they must never be picked as an event's rule.
function isAnomalyEvaluationRule(ruleId: number | null): boolean {
  return ruleId === 949110 || ruleId === 980130;
}

/** Build RuleInfo from a ModSecurity-format rule string, or null if it isn't a specific attack rule. */
export function ruleInfoFromMessage(msg: string): RuleInfo | null {
  const ruleIdStr = extractBracketField(msg, 'id');
  const ruleId = ruleIdStr ? parseInt(ruleIdStr, 10) : null;
  if (isAnomalyEvaluationRule(ruleId)) return null;
  return {
    ruleId,
    ruleMessage: extractBracketField(msg, 'msg'),
    severity: extractBracketField(msg, 'severity'),
  };
}

async function readRulesLog(startOffset: number): Promise<{ ruleMap: Map<string, RuleInfo>; newOffset: number }> {
  const ruleMap = new Map<string, RuleInfo>();
  const { lines, newOffset } = await readLines(startOffset, RULES_LOG);

  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as { msg?: string };
      const msg = entry.msg ?? '';
      const uniqueId = extractBracketField(msg, 'unique_id');
      if (!uniqueId) continue;
      // Keep only the first detection rule per unique_id
      if (ruleMap.has(uniqueId)) continue;
      const info = ruleInfoFromMessage(msg);
      if (!info) continue;
      ruleMap.set(uniqueId, info);
    } catch {
      // skip malformed lines
    }
  }

  return { ruleMap, newOffset };
}

// ── audit log parsing ─────────────────────────────────────────────────────────

interface CorazaAuditEntry {
  transaction?: {
    id?: string;
    client_ip?: string;
    // unix_timestamp is nanoseconds since epoch
    unix_timestamp?: number;
    timestamp?: string;
    // is_interrupted: true means the request was blocked/detected by the WAF
    is_interrupted?: boolean;
    request?: {
      method?: string;
      uri?: string;
      // header values are arrays of strings (lowercase keys)
      headers?: Record<string, string[]>;
    };
  };
  // Populated when audit log part H (or K) is enabled: one entry per matched
  // rule, carrying the ModSecurity-format rule string.
  messages?: { message?: string; error_message?: string }[];
}

/**
 * Extract the first specific (non anomaly-evaluation) matched rule from a
 * Coraza audit entry's own `messages` array.
 *
 * Coraza populates `messages[].error_message` with the same ModSecurity-format
 * string that Caddy's http.handlers.waf logger writes to waf-rules.log, as long
 * as audit log part H is enabled (buildWafHandler sets `SecAuditLogParts ABFHZ`).
 * Reading it from the audit entry itself is what makes rule attribution
 * deterministic: joining against waf-rules.log only works when both files
 * happen to be written within the same parse tick, and silently loses the rule
 * — and therefore the whole event — whenever they aren't.
 */
export function ruleInfoFromAuditEntry(entry: CorazaAuditEntry): RuleInfo | null {
  for (const m of entry.messages ?? []) {
    const msg = m.error_message || m.message || '';
    if (!msg) continue;
    const info = ruleInfoFromMessage(msg);
    // Keep looking past anomaly-evaluation rules — a real attack rule usually
    // precedes them, but ordering is not guaranteed.
    if (info && info.ruleId !== null) return info;
  }
  return null;
}

export function parseLine(line: string, ruleMap: Map<string, RuleInfo>): WafEventRow | null {
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

  // unix_timestamp is nanoseconds; fall back to parsing timestamp string
  let ts: number;
  if (tx.unix_timestamp) {
    ts = Math.floor(tx.unix_timestamp / 1e9);
  } else if (tx.timestamp) {
    ts = Math.floor(new Date(tx.timestamp).getTime() / 1000);
  } else {
    ts = Math.floor(Date.now() / 1000);
  }

  // Host header is an array under lowercase key
  const hostArr = req.headers?.['host'] ?? req.headers?.['Host'];
  const host = Array.isArray(hostArr) ? (hostArr[0] ?? '') : (hostArr ?? '');

  // Prefer the rule carried by the audit entry itself; fall back to the
  // waf-rules.log join only for Coraza builds that don't populate `messages`.
  const ruleInfo = ruleInfoFromAuditEntry(entry) ?? (tx.id ? ruleMap.get(tx.id) : undefined);

  const blocked = tx.is_interrupted ?? false;

  // Only store events where a specific rule matched or the request was blocked.
  // Audit log entries without any rule match are clean requests and can be discarded.
  if (!blocked && !ruleInfo) return null;

  return {
    ts,
    host,
    client_ip: clientIp,
    country_code: lookupCountry(clientIp),
    method: req.method ?? '',
    uri: req.uri ?? '',
    rule_id: ruleInfo?.ruleId ?? null,
    rule_message: ruleInfo?.ruleMessage ?? null,
    severity: ruleInfo?.severity ?? null,
    raw_data: line,
    blocked,
  };
}

async function readAuditLog(startOffset: number): Promise<{ lines: string[]; newOffset: number }> {
  return readLines(startOffset, AUDIT_LOG);
}

/**
 * Reset the stored audit-log position so the next pass starts from the top.
 *
 * Used whenever the file we were tracking is gone or has been replaced: a
 * stored offset that belongs to a different (or deleted) inode would otherwise
 * park the parser past the end of the new file forever, since the rotation
 * guard only fires when the file is *smaller* than the last recorded size.
 */
function resetAuditLogState(): void {
  setState('waf_audit_log_offset', '0');
  setState('waf_audit_log_size', '0');
  setState('waf_audit_log_inode', '0');
}

// Only warn once per episode so a deleted audit log — or one we're never going
// to be allowed to truncate — doesn't spam a line every 30s, while still
// surfacing the condition instead of failing silently the way this used to.
let warnedAuditLogMissing = false;
let warnedTruncateFailed = false;

async function insertBatch(rows: WafEventRow[]): Promise<void> {
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    await insertWafEvents(rows.slice(i, i + BATCH_SIZE));
  }
}

// ── public API ────────────────────────────────────────────────────────────────

export async function initWafLogParser(): Promise<void> {
  await initGeoIP();
  console.log('[waf-log-parser] initialized');
}

export async function parseNewWafLogEntries(): Promise<void> {
  if (stopped) return;

  // Coraza holds the audit log open, so if the file is deleted it keeps writing
  // to the now-unlinked inode and never recreates it. Returning silently here
  // (as this used to) leaves WAF ingestion permanently dead with no trace in
  // the logs — surface it, and clear the stale offset so a recreated file is
  // read from the start.
  if (!existsSync(AUDIT_LOG)) {
    if (!warnedAuditLogMissing) {
      console.warn(`[waf-log-parser] ${AUDIT_LOG} is missing — WAF events cannot be ingested until Caddy recreates it (restart the caddy container).`);
      warnedAuditLogMissing = true;
      resetAuditLogState();
    }
    return;
  }
  warnedAuditLogMissing = false;

  try {
    // ── 1. Parse WAF rules log to build unique_id → rule info map ────────────
    const rulesOffset = parseInt(getState('waf_rules_log_offset') ?? '0', 10);
    const rulesSize = parseInt(getState('waf_rules_log_size') ?? '0', 10);

    let currentRulesSize = 0;
    if (existsSync(RULES_LOG)) {
      try { currentRulesSize = statSync(RULES_LOG).size; } catch { /* ignore */ }
    }
    const rulesStartOffset = currentRulesSize < rulesSize ? 0 : rulesOffset;
    const { ruleMap, newOffset: newRulesOffset } = await readRulesLog(rulesStartOffset);

    setState('waf_rules_log_offset', String(newRulesOffset));
    setState('waf_rules_log_size', String(currentRulesSize));

    // ── 2. Parse audit log, enriching events with rule info from map ─────────
    const storedOffset = parseInt(getState('waf_audit_log_offset') ?? '0', 10);
    const storedSize = parseInt(getState('waf_audit_log_size') ?? '0', 10);
    const storedInode = parseInt(getState('waf_audit_log_inode') ?? '0', 10);

    let currentSize: number;
    let currentInode: number;
    try {
      const st = statSync(AUDIT_LOG);
      currentSize = st.size;
      currentInode = Number(st.ino);
    } catch {
      return;
    }

    // Restart from the top when the file was rotated (shrank) or replaced by a
    // different inode. Size alone is not enough: a delete-and-recreate that has
    // already grown past the last recorded size would otherwise leave the
    // stored offset stranded beyond EOF with no way back.
    const replaced = storedInode !== 0 && currentInode !== storedInode;
    const startOffset = currentSize < storedSize || replaced ? 0 : storedOffset;
    if (replaced) {
      console.warn('[waf-log-parser] waf-audit.log was replaced (new inode) — re-reading from the start');
    }

    const { lines, newOffset } = await readAuditLog(startOffset);

    if (lines.length > 0) {
      const rows = lines.map(l => parseLine(l, ruleMap)).filter((r): r is WafEventRow => r !== null);
      if (rows.length > 0) {
        await insertBatch(rows);
        console.log(`[waf-log-parser] inserted ${rows.length} WAF events`);
      }
    }

    // Persist progress BEFORE attempting truncation. Truncation is a best-effort
    // disk-space guard that fails with EACCES whenever web and caddy run as
    // different UIDs (Coraza creates the file owned by caddy), and doing it
    // first meant that failure aborted the pass and froze these offsets — so
    // every later pass re-read and re-inserted the same tail forever.
    setState('waf_audit_log_offset', String(newOffset));
    setState('waf_audit_log_size', String(currentSize));
    setState('waf_audit_log_inode', String(currentInode));

    // Once we've read through to the current end of file, it's safe to
    // truncate: Coraza appends via O_APPEND, so writes after truncation land
    // correctly at the new (empty) end of file.
    //
    // Truncation relies on waf-audit.log being GROUP-WRITABLE for web's
    // supplementary CADDY_GID (group_add in docker-compose.yml). That mode is
    // whatever Coraza happened to create the file with — it is not pinned by
    // any config. If the file is ever recreated without g+w, truncateSync
    // fails with EACCES, the warning below fires, and the log grows
    // unbounded until someone chgrp/chmods the file for the caddy GID.
    if (newOffset === currentSize && currentSize > AUDIT_LOG_TRUNCATE_THRESHOLD) {
      try {
        truncateSync(AUDIT_LOG, 0);
        // Same inode, now empty — keep tracking it, just rewind.
        setState('waf_audit_log_offset', '0');
        setState('waf_audit_log_size', '0');
        warnedTruncateFailed = false;
        console.log(`[waf-log-parser] truncated waf-audit.log after ingesting ${currentSize} bytes`);
      } catch (err) {
        if (!warnedTruncateFailed) {
          const code = (err as NodeJS.ErrnoException).code;
          console.warn(
            `[waf-log-parser] could not truncate ${AUDIT_LOG} (${code ?? err}); ` +
            `it will keep growing. Ingestion is unaffected. Truncation requires ` +
            `the file to be group-writable for web's supplementary CADDY_GID ` +
            `(default 10000) — check its mode/owner inside the caddy container ` +
            `and fix with chgrp/chmod if it is not g+w.`
          );
          warnedTruncateFailed = true;
        }
      }
    }
  } catch (err) {
    console.error('[waf-log-parser] error during parse:', err);
  }
}

export function stopWafLogParser(): void {
  stopped = true;
}
