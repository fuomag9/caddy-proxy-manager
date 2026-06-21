/**
 * WAF handler builder and effective-config resolver for Caddy.
 * Extracted from caddy.ts so these functions can be unit tested.
 */
import { type WafSettings } from "./settings";
import { type WafHostConfig } from "./models/proxy-hosts";

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
    };
  }

  if (host?.enabled) {
    return {
      enabled: true,
      mode: host.mode ?? 'On',
      load_owasp_crs: host.load_owasp_crs ?? false,
      custom_directives: host.custom_directives ?? '',
      excluded_rule_ids: host.excluded_rule_ids,
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
    `SecRuleEngine ${waf.mode}`,
    // RelevantOnly logs transactions where a rule fired with the auditlog action (which all OWASP
    // CRS rules include via SecDefaultAction), covering both blocked and DetectionOnly hits.
    // Clean requests with no rule matches are silently skipped, avoiding massive log growth.
    'SecAuditEngine RelevantOnly',
    'SecAuditLog /logs/waf-audit.log',
    'SecAuditLogFormat JSON',
    // Omit request/response bodies (parts I, J, E) and intermediate response headers (D)
    // to prevent logging multi-MB payloads. Headers (B, F) and rule match trailer (H) are kept.
    'SecAuditLogParts ABFHZ',
    'SecResponseBodyAccess Off',
  );

  // Allowlist approach: only permit known-safe directive prefixes in custom directives
  if (waf.custom_directives?.trim()) {
    const directives = waf.custom_directives.trim();
    const allowedPrefixes = [
      /^SecRule\s/,
      /^SecAction\s/,
      /^SecMarker\s/,
      /^SecDefaultAction\s/,
    ];
    const allowedBodyLimitDirectives = [
      /^SecRequestBodyLimit\s+\d+\s*$/i,
      /^SecRequestBodyNoFilesLimit\s+\d+\s*$/i,
      /^SecRequestBodyInMemoryLimit\s+\d+\s*$/i,
      /^SecRequestBodyLimitAction\s+(?:Reject|ProcessPartial)\s*$/i,
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
    const lines = directives.split('\n');
    const safeLines = lines.filter(line => {
      const trimmed = line.trim();
      // Allow empty lines and comments
      if (!trimmed || trimmed.startsWith('#')) return true;
      // Reject Include directives (prevents file inclusion from container filesystem)
      if (/^Include\s/i.test(trimmed)) return false;
      // Check against allowlist
      const matchesAllowed =
        allowedPrefixes.some(pattern => pattern.test(trimmed)) ||
        allowedBodyLimitDirectives.some(pattern => pattern.test(trimmed));
      if (!matchesAllowed) return false;
      // Reject blocked SecRule* variants (e.g. SecRuleEngine)
      if (blockedSecRulePrefixes.some(pattern => pattern.test(trimmed))) return false;
      // Reject ctl:ruleEngine inside allowed lines (can conditionally disable WAF)
      if (/ctl:ruleEngine/i.test(trimmed)) return false;
      return true;
    });
    if (safeLines.length > 0) {
      parts.push(safeLines.join('\n'));
    }
  }

  const handler: Record<string, unknown> = { handler: 'waf', directives: parts.join('\n') };
  if (waf.load_owasp_crs) handler.load_owasp_crs = true;
  return handler;
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
