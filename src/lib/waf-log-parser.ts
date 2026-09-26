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

// Request/response headers that carry credentials. Coraza's audit log (parts
// B and F) records every header verbatim; Caddy's own access log redacts
// these, so the stored WAF event must not keep them either. The app-specific
// token headers are the ones self-hosted media and dev tools authenticate with.
const CREDENTIAL_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'x-cpm-forward-auth-proof',
  'x-plex-token',
  'x-emby-token',
  'x-emby-authorization',
  'x-mediabrowser-token',
  'private-token',
  'x-vault-token',
]);
const REDACTED = '[redacted]';

// SecLang variables naming a credential: any cookie, or a credential header.
// Rule logdata such as CRS's "Matched Data: %{TX.0} found within
// %{MATCHED_VAR_NAME}: %{MATCHED_VAR}" echoes that variable's value.
const COOKIE_VARIABLE_PREFIX = 'request_cookies:';
const CREDENTIAL_HEADER_VARIABLES = [...CREDENTIAL_HEADERS].flatMap((name) => [
  `request_headers:${name}`,
  `response_headers:${name}`,
]);
// Any text that could start one of them, for a quick skip.
const CREDENTIAL_COLLECTION = /REQUEST_COOKIES:|(?:REQUEST|RESPONSE)_HEADERS:/i;
const MATCHED_DATA = 'Matched Data: ';
const MATCHED_HEADER = 'Matched Data: Header ';
const FOUND_WITHIN = ' found within ';
// Coraza cuts a rule's msg and logdata to this many bytes before logging them.
const CORAZA_LOG_DATA_CAP = 280;
// A `[name "value"]` field of a ModSecurity-format rule message. Coraza
// Go-quotes the value, so an escaped quote never ends it early.
const RULE_MESSAGE_FIELD = /\[([A-Za-z0-9_]+) "((?:[^"\\]|\\.)*)"\]/g;
// The fields that carry a rule's msg or logdata (chained rules add numbered ones).
const MSG_OR_DATA_FIELD = /^(?:msg|data)(?:_match_\d+)?$/;
// ErrorLog writes the rule's msg unquoted after the disruptive-action prefix,
// e.g. "Coraza: Access denied (phase 2). <msg> [file ...".
const ERROR_LOG_ACTION = /^\s*Coraza: (?:Warning|[A-Za-z ]+ \(phase \d+\))\. /;

function redactHeaderMap(headers: unknown): unknown {
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) return headers;
  // fromEntries defines own properties, so a header literally named
  // "__proto__" stays a key instead of setting the object's prototype.
  return Object.fromEntries(
    Object.entries(headers as Record<string, unknown>).map(([name, value]) => [
      name,
      CREDENTIAL_HEADERS.has(name.toLowerCase())
        ? (Array.isArray(value) ? value.map(() => REDACTED) : REDACTED)
        : value,
    ])
  );
}

/** True when the transaction's request or response carried a credential header (a cookie included). */
function carriesCredentials(entry: object): boolean {
  const tx = (entry as { transaction?: unknown }).transaction;
  if (!tx || typeof tx !== 'object') return false;
  return (['request', 'response'] as const).some((part) => {
    const headers = (tx as Record<string, { headers?: unknown } | undefined>)[part]?.headers;
    if (!headers || typeof headers !== 'object') return false;
    return Object.entries(headers).some(([name, value]) =>
      CREDENTIAL_HEADERS.has(name.toLowerCase()) &&
      (Array.isArray(value) ? value.some((v) => Boolean(v)) : Boolean(value))
    );
  });
}

/** True when `name` is a cookie or credential header variable, e.g. `REQUEST_COOKIES:session`. */
function isCredentialVariable(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.startsWith(COOKIE_VARIABLE_PREFIX) || CREDENTIAL_HEADER_VARIABLES.includes(lower);
}

/** True when `text` is the start of a credential variable name cut short, e.g. `REQUEST_COO`. */
function isCredentialVariablePrefix(text: string): boolean {
  const lower = text.toLowerCase();
  return [COOKIE_VARIABLE_PREFIX, ...CREDENTIAL_HEADER_VARIABLES].some(
    (name) => name.length > lower.length && name.startsWith(lower)
  );
}

function utf8Length(codePoint: number): number {
  if (!(codePoint >= 0)) return 1;
  return codePoint < 0x80 ? 1 : codePoint < 0x800 ? 2 : codePoint < 0x10000 ? 3 : 4;
}

/** Byte length of the text a Go-quoted (%q) string holds, escapes decoded. */
function goQuotedByteLength(quoted: string): number {
  let bytes = 0;
  for (let i = 0; i < quoted.length;) {
    if (quoted[i] === '\\' && i + 1 < quoted.length) {
      const kind = quoted[i + 1];
      if (kind === 'x') {
        bytes += 1;
        i += 4;
      } else if (kind === 'u' || kind === 'U') {
        const digits = kind === 'u' ? 4 : 8;
        bytes += utf8Length(parseInt(quoted.slice(i + 2, i + 2 + digits), 16));
        i += 2 + digits;
      } else if (kind >= '0' && kind <= '7') {
        bytes += 1;
        i += 4;
      } else {
        bytes += 1;
        i += 2;
      }
      continue;
    }
    const codePoint = quoted.codePointAt(i)!;
    bytes += utf8Length(codePoint);
    i += codePoint > 0xffff ? 2 : 1;
  }
  return bytes;
}

/**
 * Redacts the credential value a rule's msg or logdata `text` reports. The
 * variable name is looked for only where logdata puts it: after the first
 * " found within " of "Matched Data: X found within NAME[: VALUE]", after
 * "Matched Data: Header " in "Matched Data: Header NAME: VALUE", and at the
 * start of "NAME=VALUE" or "NAME: VALUE" (whichever separator comes first).
 * X and VALUE are request data, so a variable name written inside them never
 * counts.
 *
 * Coraza cuts logdata at 280 bytes (`capped`), which can remove NAME and leave
 * only the start of the matched value. When the transaction carried
 * credentials (`credentialed`), that excerpt is redacted if what is left of
 * NAME could be the start of a credential variable, or if no " found within "
 * is left at all in a capped text.
 */
function redactCredentialText(text: string, credentialed: boolean, capped: boolean): string {
  if (!text.startsWith(MATCHED_DATA)) {
    // "%{MATCHED_VAR_NAME}=%{MATCHED_VAR}" or "%{MATCHED_VAR_NAME}: %{MATCHED_VAR}".
    const separator = [text.indexOf('='), text.indexOf(': ')]
      .filter((index) => index > 0)
      .reduce((first, index) => Math.min(first, index), Infinity);
    if (separator === Infinity || !isCredentialVariable(text.slice(0, separator))) return text;
    return text[separator] === '='
      ? `${text.slice(0, separator)}=${REDACTED}`
      : `${text.slice(0, separator)}: ${REDACTED}`;
  }
  const within = text.indexOf(FOUND_WITHIN, MATCHED_DATA.length);
  if (within === -1) {
    if (text.startsWith(MATCHED_HEADER)) {
      const separator = text.indexOf(': ', MATCHED_HEADER.length);
      return separator !== -1 && isCredentialVariable(text.slice(MATCHED_HEADER.length, separator))
        ? `${text.slice(0, separator)}: ${REDACTED}`
        : text;
    }
    return credentialed && capped ? `${MATCHED_DATA}${REDACTED}` : text;
  }
  const after = text.slice(within + FOUND_WITHIN.length);
  // Legitimate credentials never contain " found within ", so a second one
  // came from request data, and NAME can't be told apart from it.
  if (after.includes(FOUND_WITHIN)) return text;
  const separator = after.indexOf(': ');
  const credential = separator === -1
    // NAME ends the text: the logdata stops there, or the cap cut NAME or
    // the ": " after it.
    ? isCredentialVariable(after) || isCredentialVariable(after.replace(/:$/, ''))
      || (credentialed && isCredentialVariablePrefix(after))
    : isCredentialVariable(after.slice(0, separator));
  if (!credential) return text;
  const name = separator === -1 ? after : `${after.slice(0, separator)}: ${REDACTED}`;
  return `${MATCHED_DATA}${REDACTED}${FOUND_WITHIN}${name}`;
}

/** redactCredentialText for a plain (not Go-quoted) msg or logdata string. */
function redactPlainText(text: string, credentialed: boolean): string {
  return redactCredentialText(text, credentialed, Buffer.byteLength(text, 'utf8') >= CORAZA_LOG_DATA_CAP);
}

/**
 * A ModSecurity-format rule message with redactCredentialText applied to its
 * msg and data fields, and to the unquoted msg ErrorLog writes before them.
 * A message with no fields is treated as a plain msg.
 */
function redactRuleMessage(message: string, credentialed: boolean): string {
  if (!message.includes(MATCHED_DATA) && !CREDENTIAL_COLLECTION.test(message)) return message;
  const between = (segment: string) => {
    const action = ERROR_LOG_ACTION.exec(segment)?.[0] ?? '';
    const msg = segment.slice(action.length).trimEnd();
    return `${action}${redactPlainText(msg, credentialed)}${segment.slice(action.length + msg.length)}`;
  };
  let out = '';
  let last = 0;
  for (const field of message.matchAll(RULE_MESSAGE_FIELD)) {
    const [whole, name, value] = field;
    out += between(message.slice(last, field.index));
    out += MSG_OR_DATA_FIELD.test(name)
      ? `[${name} "${redactCredentialText(value, credentialed, goQuotedByteLength(value) >= CORAZA_LOG_DATA_CAP)}"]`
      : whole;
    last = field.index + whole.length;
  }
  return out + between(message.slice(last));
}

function redactMessages(messages: unknown, credentialed: boolean): void {
  if (!Array.isArray(messages)) return;
  for (const message of messages) {
    if (!message || typeof message !== 'object') continue;
    const m = message as Record<string, unknown>;
    // error_message is the ModSecurity-format string (audit part H), which
    // older Coraza builds wrote to `message`; data.* (part K) are the plain
    // msg and logdata.
    if (typeof m.error_message === 'string') m.error_message = redactRuleMessage(m.error_message, credentialed);
    if (typeof m.message === 'string') m.message = redactRuleMessage(m.message, credentialed);
    const data = m.data as Record<string, unknown> | null | undefined;
    if (data && typeof data === 'object') {
      if (typeof data.msg === 'string') data.msg = redactPlainText(data.msg, credentialed);
      if (typeof data.data === 'string') data.data = redactPlainText(data.data, credentialed);
    }
  }
}

/**
 * The audit entry with credential header values — and the credential values
 * matched rules echo in their messages — replaced, for storage.
 */
export function redactAuditEntry(entry: unknown): unknown {
  if (!entry || typeof entry !== 'object') return entry;
  const credentialed = carriesCredentials(entry);
  const copy = structuredClone(entry) as { transaction?: Record<string, unknown>; messages?: unknown };
  const tx = copy.transaction;
  if (tx && typeof tx === 'object') {
    for (const part of ['request', 'response'] as const) {
      const section = tx[part] as Record<string, unknown> | undefined;
      if (section && typeof section === 'object' && 'headers' in section) {
        section.headers = redactHeaderMap(section.headers);
      }
    }
  }
  redactMessages(copy.messages, credentialed);
  return copy;
}

/**
 * The redacted entry serialized for raw_data. unix_timestamp is nanoseconds,
 * past what a JS number holds exactly, so the digits from the original line
 * are put back instead of the rounded re-serialization.
 */
function storedRawData(line: string, redacted: CorazaAuditEntry): string {
  const json = JSON.stringify(redacted);
  const ts = redacted.transaction?.unix_timestamp;
  if (typeof ts !== 'number' || Number.isSafeInteger(ts)) return json;
  const original = /"unix_timestamp"\s*:\s*(\d+)\s*[,}]/.exec(line)?.[1];
  if (!original || Number(original) !== ts) return json;
  return json.replace(`"unix_timestamp":${JSON.stringify(ts)}`, `"unix_timestamp":${original}`);
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
  // Read from the redacted entry so rule_message matches what raw_data keeps.
  const redacted = redactAuditEntry(entry) as CorazaAuditEntry;
  const ruleInfo = ruleInfoFromAuditEntry(redacted) ?? (tx.id ? ruleMap.get(tx.id) : undefined);

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
    raw_data: storedRawData(line, redacted),
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
