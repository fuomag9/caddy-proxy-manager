/**
 * WAF handler builder and effective-config resolver for Caddy.
 * Extracted from caddy.ts so these functions can be unit tested.
 */
import { type WafSettings } from "./settings";
import { type WafHostConfig } from "./models/proxy-hosts";

// ---------------------------------------------------------------------------
// Request body limits
// ---------------------------------------------------------------------------

/**
 * Coraza refuses to build a WAF whose request body limit exceeds 1 GiB
 * (internal/corazawaf/waf.go — "request body limit should be at most 1GiB").
 * coraza-caddy constructs its WAF while Caddy is loading the config, so a
 * single out-of-range value makes Caddy reject the ENTIRE config document —
 * every host goes unapplied, not just the offending one. Never emit a value
 * above this.
 */
export const CORAZA_MAX_BODY_LIMIT = 1_073_741_824; // 1 GiB

/** Below ~1 KiB the limit is meaningless and only serves to break uploads. */
export const CORAZA_MIN_BODY_LIMIT = 1_024;

/** Coraza's built-in default when no SecRequestBodyLimit directive is parsed. */
export const CORAZA_DEFAULT_BODY_LIMIT = 134_217_728; // 128 MiB

/**
 * SecRequestBodyLimit / SecRequestBodyInMemoryLimit set by
 * `@coraza.conf-recommended`, which we Include when load_owasp_crs is on.
 * The 12.5 MiB limit is why large uploads (Nextcloud/Immich chunks) fail with
 * the CRS enabled while the same host works with it off.
 */
export const CRS_BODY_LIMIT = 13_107_200; // 12.5 MiB
export const CRS_IN_MEMORY_BODY_LIMIT = 131_072; // 128 KiB

/** True when `value` is a byte count Coraza will accept for a body limit. */
export function isValidBodyLimit(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= CORAZA_MIN_BODY_LIMIT &&
    value <= CORAZA_MAX_BODY_LIMIT
  );
}

export function bodyLimitRangeMessage(label: string): string {
  return `${label} must be an integer between ${CORAZA_MIN_BODY_LIMIT} and ${CORAZA_MAX_BODY_LIMIT} bytes (1 GiB is Coraza's hard maximum)`;
}

/**
 * The settings are stored in bytes (what SecLang takes), but the forms ask for
 * MiB — nobody sizes an upload limit in bytes. Anything finer stays reachable
 * through the custom directives.
 */
export const BYTES_PER_MIB = 1_048_576;
export const MIN_BODY_LIMIT_MIB = 1;
export const MAX_BODY_LIMIT_MIB = CORAZA_MAX_BODY_LIMIT / BYTES_PER_MIB; // 1024

export function bytesToMib(bytes: number | undefined): string {
  return typeof bytes === "number" && bytes > 0 ? String(Math.round(bytes / BYTES_PER_MIB)) : "";
}

/** Parses a MiB form field into bytes. Blank means "unset — inherit the default". */
export function parseBodyLimitMib(raw: unknown, label: string): number | undefined {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  const mib = Number(raw.trim());
  if (!Number.isInteger(mib) || mib < MIN_BODY_LIMIT_MIB || mib > MAX_BODY_LIMIT_MIB) {
    throw new Error(`${label} must be a whole number of MiB between ${MIN_BODY_LIMIT_MIB} and ${MAX_BODY_LIMIT_MIB}`);
  }
  return mib * BYTES_PER_MIB;
}

/** SecRequestBody*Limit directives that carry a byte count. */
const BODY_LIMIT_DIRECTIVE =
  /^(SecRequestBodyLimit|SecRequestBodyNoFilesLimit|SecRequestBodyInMemoryLimit)\s+(\d+)\s*$/i;
const BODY_LIMIT_ACTION_DIRECTIVE = /^SecRequestBodyLimitAction\s+(?:Reject|ProcessPartial)\s*$/i;

/**
 * Returns the first custom directive whose byte count Coraza would reject, or
 * null when every body-limit line is in range. Input layers call this so the
 * user gets a precise error at save time instead of a silent drop here plus an
 * opaque "Caddy rejected configuration" later.
 */
export function findInvalidBodyLimitDirective(directives: string | null | undefined): string | null {
  if (!directives?.trim()) return null;
  for (const line of directives.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = BODY_LIMIT_DIRECTIVE.exec(trimmed);
    if (match && !isValidBodyLimit(Number(match[2]))) return trimmed;
  }
  return null;
}

/** A custom SecLang line CPM chose not to send to Caddy, plus why. */
export interface DroppedWafDirective {
  line: string;
  reason: string;
}

/**
 * The strict allowlist that governs which user-supplied SecLang lines reach the
 * generated Caddy `waf` handler. Returns the lines that WILL be emitted
 * (`kept`) and the ones CPM will silently discard (`dropped`), each with a
 * human-readable reason.
 *
 * buildWafHandler uses `kept` to build the handler. The validation layers use
 * `dropped` to warn the user up front, because today a discarded line fails
 * silently — the source of "my WAF rule does nothing" reports (see discussion
 * #146 re: SecRuleUpdateActionById being dropped while SecRule works).
 */
export function filterCustomDirectives(
  raw: string | null | undefined
): { kept: string[]; dropped: DroppedWafDirective[] } {
  const kept: string[] = [];
  const dropped: DroppedWafDirective[] = [];
  if (!raw?.trim()) return { kept, dropped };

  const allowedPrefixes = [
    /^SecRule\s/,
    /^SecAction\s/,
    /^SecMarker\s/,
    /^SecDefaultAction\s/,
  ];
  // SecRule* variants that are NOT plain SecRule (must be rejected)
  const blockedSecRulePrefixes = [
    /^SecRuleEngine\s/i,
    /^SecRuleRemoveById\s/i,
    /^SecRuleRemoveByTag\s/i,
    /^SecRuleRemoveByMsg\s/i,
    /^SecRuleUpdateActionById\s/i,
    /^SecRuleUpdateTargetById\s/i,
  ];

  for (const line of raw.trim().split('\n')) {
    const trimmed = line.trim();
    // Allow empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) {
      kept.push(line);
      continue;
    }
    // Reject Include directives (prevents file inclusion from container filesystem)
    if (/^Include\s/i.test(trimmed)) {
      dropped.push({ line: trimmed, reason: 'Include is not allowed (prevents reading arbitrary files from the container filesystem)' });
      continue;
    }
    // Body limits are allowed, but only inside the range Coraza accepts —
    // an out-of-range value would make Caddy reject the whole config
    // document. Input validation reports these; dropping here is the net.
    // (SecRequestBodyNoFilesLimit parses but is not enforced by Coraza:
    // corazawaf/coraza#896. Kept accepted so existing configs keep loading.)
    const bodyLimit = BODY_LIMIT_DIRECTIVE.exec(trimmed);
    if (bodyLimit) {
      if (isValidBodyLimit(Number(bodyLimit[2]))) {
        kept.push(line);
      } else {
        dropped.push({ line: trimmed, reason: `body limit is out of range — ${bodyLimitRangeMessage('the byte count')}` });
      }
      continue;
    }
    if (BODY_LIMIT_ACTION_DIRECTIVE.test(trimmed)) {
      kept.push(line);
      continue;
    }
    // Reject blocked SecRule* variants (e.g. SecRuleEngine, SecRuleUpdateActionById)
    // Checked before the generic allowlist so the reason is specific.
    if (blockedSecRulePrefixes.some((pattern) => pattern.test(trimmed))) {
      dropped.push({ line: trimmed, reason: 'rule-mutation/engine directives are not allowed (they can disable WAF protections or override rule actions)' });
      continue;
    }
    // Check against allowlist
    if (!allowedPrefixes.some((pattern) => pattern.test(trimmed))) {
      dropped.push({ line: trimmed, reason: 'not an allowed directive — only SecRule, SecAction, SecMarker, and SecDefaultAction are permitted' });
      continue;
    }
    // Reject ctl:ruleEngine inside allowed lines (can conditionally disable WAF)
    if (/ctl:ruleEngine/i.test(trimmed)) {
      dropped.push({ line: trimmed, reason: 'ctl:ruleEngine is not allowed (it can conditionally disable the WAF)' });
      continue;
    }
    kept.push(line);
  }
  return { kept, dropped };
}

/**
 * Human-readable message describing the custom directives CPM will silently
 * drop. Shared by the global-settings and per-host validators so users learn
 * at save time — not after a confusing "nothing blocked" report.
 */
export function droppedWafDirectiveMessage(dropped: DroppedWafDirective[]): string {
  const items = dropped.map((d) => `"${d.line}" → ${d.reason}`).join('\n');
  return `waf.custom_directives contains ${dropped.length} line(s) that will be dropped and never sent to Caddy:\n${items}\nRemove or rewrite them for them to take effect.`;
}

/**
 * Resolves the effective WAF settings for a proxy host by merging or overriding
 * the global WAF settings with the per-host WAF config.
 *
 * Semantics:
 *  - host = null/undefined          → global settings apply as-is
 *  - host.enabled === false          → explicit opt-out; no WAF regardless of global
 *  - host.waf_mode === "override"    → use host config entirely, ignore global
 *  - host.waf_mode === "merge" (default) → merge host settings on top of global
 */
export function resolveEffectiveWaf(
  global: WafSettings | null,
  host: WafHostConfig | null | undefined
): WafSettings | null {
  const hostEnabled = host?.enabled;
  const globalEnabled = global?.enabled;

  if (!hostEnabled && !globalEnabled) return null;

  // Override mode: use host config entirely
  if (host && host.waf_mode === "override") {
    if (!hostEnabled) return null;
    return {
      enabled: true,
      mode: host.mode ?? 'On',
      load_owasp_crs: host.load_owasp_crs ?? false,
      custom_directives: host.custom_directives ?? '',
      excluded_rule_ids: host.excluded_rule_ids,
      request_body_limit: host.request_body_limit,
      request_body_in_memory_limit: host.request_body_in_memory_limit,
      request_body_limit_action: host.request_body_limit_action,
    };
  }

  // Merge mode: start with global, overlay host fields.
  // host.enabled === false is an explicit opt-out — respect it even when global is on.
  if (host && global) {
    if (host.enabled === false) return null;
    return {
      enabled: true,
      mode: host.mode ?? global.mode,
      load_owasp_crs: host.load_owasp_crs ?? global.load_owasp_crs,
      custom_directives: [global.custom_directives, host.custom_directives].filter(Boolean).join('\n'),
      excluded_rule_ids: [
        ...(global.excluded_rule_ids ?? []),
        ...(host.excluded_rule_ids ?? []),
      ],
      // Body limits are scalars, not lists: the host value wins when set,
      // otherwise the global one applies.
      request_body_limit: host.request_body_limit ?? global.request_body_limit,
      request_body_in_memory_limit:
        host.request_body_in_memory_limit ?? global.request_body_in_memory_limit,
      request_body_limit_action:
        host.request_body_limit_action ?? global.request_body_limit_action,
    };
  }

  if (host?.enabled) {
    return {
      enabled: true,
      mode: host.mode ?? 'On',
      load_owasp_crs: host.load_owasp_crs ?? false,
      custom_directives: host.custom_directives ?? '',
      excluded_rule_ids: host.excluded_rule_ids,
      request_body_limit: host.request_body_limit,
      request_body_in_memory_limit: host.request_body_in_memory_limit,
      request_body_limit_action: host.request_body_limit_action,
    };
  }
  if (global?.enabled) return global;
  return null;
}

/**
 * Caddy request matcher for a WebSocket upgrade handshake — the HTTP GET that
 * carries `Connection: Upgrade` and `Upgrade: websocket`.  Mirrors Caddy's own
 * built-in `@websockets` named matcher so detection matches what `reverse_proxy`
 * itself uses to switch into tunnel mode.
 */
export const WEBSOCKET_UPGRADE_MATCHER: Record<string, unknown> = {
  header: {
    Connection: ['*Upgrade*'],
    Upgrade: ['websocket'],
  },
};

/**
 * Builds the Caddy `waf` handler object for the given WAF settings.
 *
 * Important: @-prefixed SecLang paths (e.g. @coraza.conf-recommended) resolve
 * from the embedded coraza-coreruleset filesystem, which is only mounted by the
 * Caddy WAF plugin when `load_owasp_crs: true`.  Including those directives when
 * the embedded filesystem is unavailable causes a Caddy config load error:
 *   "failed to readfile: open @coraza.conf-recommended: no such file or directory"
 * Therefore all @-prefixed includes are gated behind load_owasp_crs.
 */
export function buildWafHandler(waf: WafSettings): Record<string, unknown> {
  const parts: string[] = [];

  // `mode` is interpolated straight into the directive block, and settings are
  // stored without validation — so anything other than a known engine mode
  // (e.g. "On\nSecRuleRemoveById 1-999999") would smuggle in SecLang that the
  // custom_directives allowlist below exists to reject. Clamp to Coraza's three
  // real values and fall back to the safe one.
  const engineMode = waf.mode === 'Off' || waf.mode === 'DetectionOnly' ? waf.mode : 'On';

  if (waf.load_owasp_crs) {
    // @-prefixed paths resolve from the embedded coraza-coreruleset filesystem,
    // which is only mounted when load_owasp_crs is true.
    parts.push(
      'Include @coraza.conf-recommended',
      'Include @crs-setup.conf.example',
      'Include @owasp_crs/*.conf',
    );
  }

  // Runtime-validate excluded_rule_ids are positive integers
  if (waf.excluded_rule_ids?.length) {
    const validIds = waf.excluded_rule_ids.filter(
      (id): id is number => typeof id === "number" && Number.isFinite(id) && id > 0 && Number.isInteger(id)
    );
    if (validIds.length > 0) {
      parts.push(`SecRuleRemoveById ${validIds.join(' ')}`);
    }
  }

  parts.push(
    `SecRuleEngine ${engineMode}`,
    // RelevantOnly logs transactions where a rule fired with the auditlog action (which all OWASP
    // CRS rules include via SecDefaultAction), covering both blocked and DetectionOnly hits.
    // Clean requests with no rule matches are silently skipped, avoiding massive log growth.
    'SecAuditEngine RelevantOnly',
    'SecAuditLog /logs/waf-audit.log',
    'SecAuditLogFormat JSON',
    // Note: the audit log ends up owned by caddy with mode 0644, so the web
    // container (a different UID) can read it but not truncate it once it passes
    // the parser's size cap. SecAuditLogFileMode cannot fix that — the container's
    // 0022 umask strips group-write from any mode we ask for, and requesting 0660
    // would only narrow world-read to group-read, breaking deployments that don't
    // add web to the caddy group. waf-log-parser therefore treats truncation as
    // best-effort and keeps ingesting when it fails.
    // Part H carries the matched rules, which waf-log-parser reads to attribute
    // each event to a rule id/message/severity. Bodies (I, J, E) and intermediate
    // response headers (D) are omitted to avoid logging multi-MB payloads.
    'SecAuditLogParts ABFHZ',
    'SecResponseBodyAccess Off',
  );

  // Body limits from the dedicated settings fields. Emitted after the CRS
  // include (so they override @coraza.conf-recommended's 12.5 MiB) but before
  // custom_directives, which stay the escape hatch that wins over the UI.
  if (isValidBodyLimit(waf.request_body_limit)) {
    parts.push(`SecRequestBodyLimit ${waf.request_body_limit}`);
  }
  if (isValidBodyLimit(waf.request_body_in_memory_limit)) {
    parts.push(`SecRequestBodyInMemoryLimit ${waf.request_body_in_memory_limit}`);
  }
  if (waf.request_body_limit_action === 'Reject' || waf.request_body_limit_action === 'ProcessPartial') {
    parts.push(`SecRequestBodyLimitAction ${waf.request_body_limit_action}`);
  }

  // Allowlist approach: only permit known-safe directive prefixes in custom directives
  const { kept } = filterCustomDirectives(waf.custom_directives);
  if (kept.length > 0) {
    parts.push(kept.join('\n'));
  }

  const handler: Record<string, unknown> = {
    handler: 'waf',
    directives: reconcileInMemoryBodyLimit(parts.join('\n'), waf.load_owasp_crs),
  };
  if (waf.load_owasp_crs) handler.load_owasp_crs = true;
  return handler;
}

/**
 * Coraza also validates `SecRequestBodyInMemoryLimit <= SecRequestBodyLimit`
 * and fails config load when it doesn't hold. That pairing is easy to break by
 * accident: lowering only the request limit leaves the CRS's 128 KiB in-memory
 * value above it, and the resulting rejection takes down every host's config,
 * not just this handler's.
 *
 * Coraza validates the FINAL parsed values, so only the last directive of each
 * kind matters. When they conflict, append a corrective in-memory line — the
 * last one wins, so the config stays loadable with the user's request limit
 * intact.
 */
function reconcileInMemoryBodyLimit(directives: string, crsLoaded: boolean): string {
  let requestLimit = crsLoaded ? CRS_BODY_LIMIT : CORAZA_DEFAULT_BODY_LIMIT;
  let inMemoryLimit = crsLoaded ? CRS_IN_MEMORY_BODY_LIMIT : null;

  for (const line of directives.split('\n')) {
    const match = BODY_LIMIT_DIRECTIVE.exec(line.trim());
    if (!match) continue;
    const name = match[1].toLowerCase();
    const value = Number(match[2]);
    if (name === 'secrequestbodylimit') requestLimit = value;
    else if (name === 'secrequestbodyinmemorylimit') inMemoryLimit = value;
  }

  if (inMemoryLimit === null || inMemoryLimit <= requestLimit) return directives;
  return `${directives}\nSecRequestBodyInMemoryLimit ${requestLimit}`;
}

/**
 * Builds the handler-chain entry that applies the WAF for a proxy route.
 *
 * When allowWebsocket is true the WAF handler is wrapped in a non-terminal
 * subroute that only runs for NON-WebSocket requests.  WebSocket upgrades must
 * bypass the coraza handler ENTIRELY — not merely have the rule engine turned
 * off via `ctl:ruleEngine=off` (issue #195):
 *
 *   The coraza-caddy middleware wraps the response writer to inspect the
 *   upstream response (SecLang phase 3/4 rules).  That wrapper does not pass
 *   through the connection hijack that a `101 Switching Protocols` upgrade
 *   performs, so the raw WebSocket bytes leak out without the HTTP status line.
 *   The client sees a corrupt "HTTP/0.9" response and the handshake fails.
 *   Disabling only the rule engine leaves the response wrapper in place, so the
 *   connection is still mangled — routing around the handler is the only fix.
 *
 * Because a Caddy `subroute` compiles its inner routes with the OUTER `next`
 * handler as their continuation, the WAF handler still wraps the downstream
 * `reverse_proxy` for ordinary requests (response inspection preserved); only
 * the matched-out WebSocket upgrade skips it and falls straight through to the
 * next handler in the chain.
 *
 * When allowWebsocket is false the bare WAF handler is returned so WebSocket
 * upgrades are inspected (and potentially blocked) like any other request.
 */
export function buildWafHandlerEntry(
  waf: WafSettings,
  allowWebsocket = false
): Record<string, unknown> {
  const wafHandler = buildWafHandler(waf);
  if (!allowWebsocket) return wafHandler;
  return {
    handler: 'subroute',
    routes: [
      {
        match: [{ not: [WEBSOCKET_UPGRADE_MATCHER] }],
        handle: [wafHandler],
      },
    ],
  };
}
