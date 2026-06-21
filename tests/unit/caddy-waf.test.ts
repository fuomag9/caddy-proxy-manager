/**
 * Unit tests for src/lib/caddy-waf.ts
 *
 * Key regression: when WAF is enabled but OWASP CRS is NOT loaded,
 * the generated directives must NOT contain any @-prefixed Include paths
 * (e.g. @coraza.conf-recommended).  Those paths only resolve from the
 * embedded coraza-coreruleset filesystem which is mounted by the Caddy
 * plugin only when load_owasp_crs=true.  Including them without the
 * filesystem causes:
 *   "failed to readfile: open @coraza.conf-recommended: no such file or directory"
 */
import { describe, it, expect } from 'vitest';
import { buildWafHandler, buildWafHandlerEntry, resolveEffectiveWaf } from '../../src/lib/caddy-waf';

const baseWaf = {
  enabled: true,
  mode: 'On' as const,
  load_owasp_crs: false,
  custom_directives: '',
};

// ---------------------------------------------------------------------------
// Regression: @-prefixed paths must not appear without load_owasp_crs
// ---------------------------------------------------------------------------

describe('buildWafHandler — without OWASP CRS', () => {
  it('does NOT include @coraza.conf-recommended when load_owasp_crs is false', () => {
    const handler = buildWafHandler({ ...baseWaf, load_owasp_crs: false });
    expect(handler.directives).not.toContain('@coraza.conf-recommended');
  });

  it('does NOT include any @-prefixed Include when load_owasp_crs is false', () => {
    const handler = buildWafHandler({ ...baseWaf, load_owasp_crs: false });
    // Guard against any future @-prefixed file references leaking in
    expect(handler.directives).not.toMatch(/Include @/);
  });

  it('does NOT set load_owasp_crs field on handler when disabled', () => {
    const handler = buildWafHandler({ ...baseWaf, load_owasp_crs: false });
    expect(handler.load_owasp_crs).toBeUndefined();
  });

  it('still emits SecRuleEngine directive', () => {
    const handler = buildWafHandler({ ...baseWaf, mode: 'On', load_owasp_crs: false });
    expect(handler.directives).toContain('SecRuleEngine On');
  });

  it('still emits SecRuleEngine Off in DetectionOnly-like mode', () => {
    const handler = buildWafHandler({ ...baseWaf, mode: 'Off', load_owasp_crs: false });
    expect(handler.directives).toContain('SecRuleEngine Off');
  });

  it('includes custom directives when provided', () => {
    const directive = 'SecRule REQUEST_HEADERS:User-Agent "@contains leakix.net" "id:9002,phase:1,deny,status:403,log"';
    const handler = buildWafHandler({ ...baseWaf, load_owasp_crs: false, custom_directives: directive });
    expect(handler.directives).toContain(directive);
  });

  it('does not append empty/whitespace-only custom_directives', () => {
    const handler = buildWafHandler({ ...baseWaf, load_owasp_crs: false, custom_directives: '   ' });
    // The directives string should end with the last standard directive
    expect((handler.directives as string).trimEnd()).not.toMatch(/\s+$/);
  });

  it('allows request body limit directives from custom directives', () => {
    const directives = [
      'SecRequestBodyLimit 10737418240',
      'SecRequestBodyNoFilesLimit 10737418240',
    ].join('\n');
    const handler = buildWafHandler({ ...baseWaf, custom_directives: directives });
    expect(handler.directives).toContain('SecRequestBodyLimit 10737418240');
    expect(handler.directives).toContain('SecRequestBodyNoFilesLimit 10737418240');
  });

  it('allows related constrained request body limit directives', () => {
    const directives = [
      'SecRequestBodyInMemoryLimit 131072',
      'SecRequestBodyLimitAction ProcessPartial',
    ].join('\n');
    const handler = buildWafHandler({ ...baseWaf, custom_directives: directives });
    expect(handler.directives).toContain('SecRequestBodyInMemoryLimit 131072');
    expect(handler.directives).toContain('SecRequestBodyLimitAction ProcessPartial');
  });

  it('still rejects request body directives that can disable inspection', () => {
    const handler = buildWafHandler({
      ...baseWaf,
      custom_directives: 'SecRequestBodyAccess Off',
    });
    expect(handler.directives).not.toContain('SecRequestBodyAccess Off');
  });
});

// ---------------------------------------------------------------------------
// With OWASP CRS enabled
// ---------------------------------------------------------------------------

describe('buildWafHandler — with OWASP CRS', () => {
  it('includes @coraza.conf-recommended when load_owasp_crs is true', () => {
    const handler = buildWafHandler({ ...baseWaf, load_owasp_crs: true });
    expect(handler.directives).toContain('Include @coraza.conf-recommended');
  });

  it('includes @crs-setup.conf.example when load_owasp_crs is true', () => {
    const handler = buildWafHandler({ ...baseWaf, load_owasp_crs: true });
    expect(handler.directives).toContain('Include @crs-setup.conf.example');
  });

  it('includes @owasp_crs/*.conf when load_owasp_crs is true', () => {
    const handler = buildWafHandler({ ...baseWaf, load_owasp_crs: true });
    expect(handler.directives).toContain('Include @owasp_crs/*.conf');
  });

  it('sets load_owasp_crs=true on the handler object', () => {
    const handler = buildWafHandler({ ...baseWaf, load_owasp_crs: true });
    expect(handler.load_owasp_crs).toBe(true);
  });

  it('@coraza.conf-recommended appears BEFORE CRS includes', () => {
    const handler = buildWafHandler({ ...baseWaf, load_owasp_crs: true });
    const directives = handler.directives as string;
    const corazaPos = directives.indexOf('@coraza.conf-recommended');
    const crsPos = directives.indexOf('@owasp_crs');
    expect(corazaPos).toBeLessThan(crsPos);
  });
});

// ---------------------------------------------------------------------------
// Excluded rule IDs
// ---------------------------------------------------------------------------

describe('buildWafHandler — excluded_rule_ids', () => {
  it('emits SecRuleRemoveById with single ID', () => {
    const handler = buildWafHandler({ ...baseWaf, excluded_rule_ids: [941100] });
    expect(handler.directives).toContain('SecRuleRemoveById 941100');
  });

  it('emits SecRuleRemoveById with multiple IDs space-separated', () => {
    const handler = buildWafHandler({ ...baseWaf, excluded_rule_ids: [941100, 942200, 943300] });
    expect(handler.directives).toContain('SecRuleRemoveById 941100 942200 943300');
  });

  it('omits SecRuleRemoveById when excluded_rule_ids is empty', () => {
    const handler = buildWafHandler({ ...baseWaf, excluded_rule_ids: [] });
    expect(handler.directives).not.toContain('SecRuleRemoveById');
  });

  it('omits SecRuleRemoveById when excluded_rule_ids is undefined', () => {
    const handler = buildWafHandler({ ...baseWaf });
    expect(handler.directives).not.toContain('SecRuleRemoveById');
  });
});

// ---------------------------------------------------------------------------
// Handler structure
// ---------------------------------------------------------------------------

describe('buildWafHandler — handler structure', () => {
  it('always sets handler="waf"', () => {
    expect(buildWafHandler(baseWaf).handler).toBe('waf');
  });

  it('directives is a non-empty string', () => {
    const handler = buildWafHandler(baseWaf);
    expect(typeof handler.directives).toBe('string');
    expect((handler.directives as string).length).toBeGreaterThan(0);
  });

  it('always includes audit log directives', () => {
    const handler = buildWafHandler(baseWaf);
    expect(handler.directives).toContain('SecAuditEngine RelevantOnly');
    expect(handler.directives).toContain('SecAuditLog /logs/waf-audit.log');
    expect(handler.directives).toContain('SecAuditLogFormat JSON');
  });
});

// ---------------------------------------------------------------------------
// resolveEffectiveWaf
// ---------------------------------------------------------------------------

const globalWaf = {
  enabled: true,
  mode: 'On' as const,
  load_owasp_crs: false,
  custom_directives: 'SecRule REQUEST_HEADERS:User-Agent "@contains leakix.net" "id:9002,phase:1,deny,status:403,log"',
};

describe('resolveEffectiveWaf — no per-host config', () => {
  it('returns null when both global and host are null', () => {
    expect(resolveEffectiveWaf(null, null)).toBeNull();
  });

  it('returns null when global is disabled and host is null', () => {
    expect(resolveEffectiveWaf({ ...globalWaf, enabled: false }, null)).toBeNull();
  });

  it('applies global WAF when host has no per-host config (null)', () => {
    const result = resolveEffectiveWaf(globalWaf, null);
    expect(result).not.toBeNull();
    expect(result!.enabled).toBe(true);
    expect(result!.custom_directives).toContain('9002');
  });

  it('applies global WAF when host config is undefined', () => {
    const result = resolveEffectiveWaf(globalWaf, undefined);
    expect(result).not.toBeNull();
    expect(result!.custom_directives).toContain('9002');
  });
});

describe('resolveEffectiveWaf — merge mode (regression: host.enabled=false must opt out)', () => {
  it('returns null when host explicitly disables WAF in merge mode (the bug fix)', () => {
    // This was the bug: host.enabled=false in merge mode was ignored and global WAF applied anyway
    const result = resolveEffectiveWaf(globalWaf, { enabled: false, waf_mode: 'merge' });
    expect(result).toBeNull();
  });

  it('returns null when host.enabled=false with no waf_mode set (defaults to merge)', () => {
    const result = resolveEffectiveWaf(globalWaf, { enabled: false });
    expect(result).toBeNull();
  });

  it('merges host settings on top of global when host is enabled', () => {
    const result = resolveEffectiveWaf(globalWaf, {
      enabled: true,
      waf_mode: 'merge',
      mode: 'On',
      load_owasp_crs: true,
      custom_directives: 'SecRule ARGS "@contains evil" "id:9003,deny"',
    });
    expect(result).not.toBeNull();
    expect(result!.load_owasp_crs).toBe(true);
    // Both global and host custom directives are present
    expect(result!.custom_directives).toContain('9002');
    expect(result!.custom_directives).toContain('9003');
  });

  it('merge result has enabled=true', () => {
    const result = resolveEffectiveWaf(globalWaf, { enabled: true, waf_mode: 'merge' });
    expect(result!.enabled).toBe(true);
  });

  it('merged excluded_rule_ids combines global and host lists', () => {
    const global = { ...globalWaf, excluded_rule_ids: [941100] };
    const result = resolveEffectiveWaf(global, {
      enabled: true,
      waf_mode: 'merge',
      excluded_rule_ids: [942200],
    });
    expect(result!.excluded_rule_ids).toContain(941100);
    expect(result!.excluded_rule_ids).toContain(942200);
  });
});

describe('resolveEffectiveWaf — override mode', () => {
  it('returns null when host.enabled=false in override mode', () => {
    const result = resolveEffectiveWaf(globalWaf, { enabled: false, waf_mode: 'override' });
    expect(result).toBeNull();
  });

  it('uses only host config in override mode, ignores global custom_directives', () => {
    const result = resolveEffectiveWaf(globalWaf, {
      enabled: true,
      waf_mode: 'override',
      mode: 'On',
      load_owasp_crs: true,
      custom_directives: 'SecRule ARGS "@contains evil" "id:9003,deny"',
    });
    expect(result).not.toBeNull();
    expect(result!.custom_directives).toBe('SecRule ARGS "@contains evil" "id:9003,deny"');
    // Global directives are NOT included
    expect(result!.custom_directives).not.toContain('9002');
    expect(result!.load_owasp_crs).toBe(true);
  });

  it('host-only WAF with no global applies correctly', () => {
    const result = resolveEffectiveWaf(null, { enabled: true, waf_mode: 'override', mode: 'On' });
    expect(result).not.toBeNull();
    expect(result!.enabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildWafHandlerEntry — WebSocket bypass (issue #195)
//
// Regression: enabling WAF on a proxy host mangled WebSocket connections into a
// corrupt "HTTP/0.9" response. The coraza middleware wraps the response writer
// to inspect the upstream response, and that wrapper breaks the 101 Switching
// Protocols connection hijack. The previous `ctl:ruleEngine=off` SecLang bypass
// did NOT help because it only disables rule evaluation, leaving the response
// wrapper in place. The fix routes WebSocket upgrades AROUND the WAF handler at
// the Caddy routing level via a subroute that excludes the upgrade request.
// ---------------------------------------------------------------------------

// Pull a deeply-nested handler tree apart for assertions
function subrouteOf(entry: Record<string, unknown>) {
  return entry as {
    handler: string;
    routes: Array<{ match: Array<Record<string, unknown>>; handle: Array<Record<string, unknown>> }>;
  };
}

describe('buildWafHandlerEntry — WebSocket bypass', () => {
  it('returns the bare WAF handler when allowWebsocket=false', () => {
    const entry = buildWafHandlerEntry(baseWaf, false);
    expect(entry.handler).toBe('waf');
    expect(typeof entry.directives).toBe('string');
  });

  it('returns the bare WAF handler when allowWebsocket not provided (default false)', () => {
    const entry = buildWafHandlerEntry(baseWaf);
    expect(entry.handler).toBe('waf');
  });

  it('wraps the WAF handler in a subroute when allowWebsocket=true', () => {
    const entry = subrouteOf(buildWafHandlerEntry(baseWaf, true));
    expect(entry.handler).toBe('subroute');
    expect(entry.routes).toHaveLength(1);
    // The inner route's only handler is the actual WAF handler
    expect(entry.routes[0].handle).toHaveLength(1);
    expect(entry.routes[0].handle[0].handler).toBe('waf');
  });

  it('subroute matches everything EXCEPT WebSocket upgrade requests', () => {
    const entry = subrouteOf(buildWafHandlerEntry(baseWaf, true));
    const match = entry.routes[0].match[0];
    // A `not` matcher on the WebSocket upgrade headers — WAF runs for non-WS only
    const not = match.not as Array<Record<string, unknown>>;
    expect(Array.isArray(not)).toBe(true);
    const header = not[0].header as Record<string, string[]>;
    expect(header.Connection).toEqual(['*Upgrade*']);
    expect(header.Upgrade).toEqual(['websocket']);
  });

  it('does NOT emit a ctl:ruleEngine=off SecLang bypass (the broken approach)', () => {
    const entry = subrouteOf(buildWafHandlerEntry(baseWaf, true));
    const directives = entry.routes[0].handle[0].directives as string;
    expect(directives).not.toContain('ctl:ruleEngine=off');
  });

  it('preserves the full WAF directive set inside the bypass subroute', () => {
    const entry = subrouteOf(buildWafHandlerEntry({ ...baseWaf, load_owasp_crs: true }, true));
    const wafHandler = entry.routes[0].handle[0];
    const directives = wafHandler.directives as string;
    expect(directives).toContain('SecRuleEngine On');
    expect(directives).toContain('SecAuditEngine RelevantOnly');
    expect(directives).toContain('Include @owasp_crs/*.conf');
    // load_owasp_crs flag must survive the wrapping
    expect(wafHandler.load_owasp_crs).toBe(true);
  });

  it('keeps custom directives inside the bypass subroute', () => {
    const entry = subrouteOf(buildWafHandlerEntry({
      ...baseWaf,
      custom_directives: 'SecRule ARGS "@contains evil" "id:9001,deny"',
    }, true));
    const directives = entry.routes[0].handle[0].directives as string;
    expect(directives).toContain('SecRule ARGS "@contains evil"');
  });
});
