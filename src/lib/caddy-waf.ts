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
 * Builds the Caddy `waf` handler object for the given WAF settings.
 *
 * Important: @-prefixed SecLang paths (e.g. @coraza.conf-recommended) resolve
 * from the embedded coraza-coreruleset filesystem, which is only mounted by the
 * Caddy WAF plugin when `load_owasp_crs: true`.  Including those directives when
 * the embedded filesystem is unavailable causes a Caddy config load error:
 *   "failed to readfile: open @coraza.conf-recommended: no such file or directory"
 * Therefore all @-prefixed includes are gated behind load_owasp_crs.
 *
 * @param allowWebsocket - When true, a SecLang rule is prepended that bypasses
 *   WAF inspection for the initial HTTP upgrade request (Upgrade: websocket).
 *   After the protocol switch the connection becomes a WebSocket tunnel that the
 *   WAF cannot inspect anyway, but without this bypass the WAF may silently drop
 *   the upgrade handshake: the block happens before SecAuditEngine captures it,
 *   producing no log entry and an unexplained connection failure.
 */
export function buildWafHandler(waf: WafSettings, allowWebsocket = false): Record<string, unknown> {
  const parts: string[] = [];

  if (allowWebsocket) {
    // WebSocket upgrade is an HTTP GET with Upgrade: websocket.  The WAF sits
    // first in the handler chain and would process this request.  After the
    // 101 Switching Protocols response the connection becomes a raw WebSocket
    // tunnel — the WAF never sees subsequent frames.  Turning the rule engine
    // off for the upgrade request prevents silent drops while having zero
    // impact on normal HTTP traffic through the same host.
    parts.push(
      'SecRule REQUEST_HEADERS:Upgrade "@rx (?i)^websocket$" ' +
      '"id:9900,phase:1,pass,nolog,noauditlog,ctl:ruleEngine=off"'
    );
  }

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
      const matchesAllowed = allowedPrefixes.some(pattern => pattern.test(trimmed));
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
