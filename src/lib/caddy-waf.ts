/**
 * WAF handler builder for Caddy — extracted from caddy.ts so it can be unit tested.
 */
import { type WafSettings } from "./settings";

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

  if (waf.excluded_rule_ids?.length) {
    parts.push(`SecRuleRemoveById ${waf.excluded_rule_ids.join(' ')}`);
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

  if (waf.custom_directives?.trim()) {
    parts.push(waf.custom_directives.trim());
  }

  const handler: Record<string, unknown> = { handler: 'waf', directives: parts.join('\n') };
  if (waf.load_owasp_crs) handler.load_owasp_crs = true;
  return handler;
}
