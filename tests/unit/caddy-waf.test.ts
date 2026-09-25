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
import {
  buildWafHandler,
  buildWafHandlerEntry,
  CORAZA_MAX_BODY_LIMIT,
  droppedWafDirectiveMessage,
  filterCustomDirectives,
  findInvalidBodyLimitDirective,
  parseBodyLimitMib,
  resolveEffectiveWaf,
} from '../../src/lib/caddy-waf';

const baseWaf = {
  enabled: true,
  mode: 'On' as const,
  load_owasp_crs: false,
  custom_directives: '',
};

// ---------------------------------------------------------------------------
// SecRuleEngine mode is interpolated into the directive block, and WAF settings
// are persisted without validation — so an unrecognised mode must never reach
// the config, or it would smuggle in SecLang past the custom_directives
// allowlist (e.g. disabling rules the allowlist explicitly refuses).
// ---------------------------------------------------------------------------

describe('buildWafHandler — SecRuleEngine mode sanitising', () => {
  function directives(mode: string): string {
    const handler = buildWafHandler({ ...baseWaf, mode: mode as typeof baseWaf.mode, load_owasp_crs: false });
    return handler.directives as string;
  }

  it('passes through the three real Coraza engine modes', () => {
    expect(directives('On')).toContain('SecRuleEngine On');
    expect(directives('Off')).toContain('SecRuleEngine Off');
    expect(directives('DetectionOnly')).toContain('SecRuleEngine DetectionOnly');
  });

  it('falls back to On for an unrecognised mode', () => {
    expect(directives('bogus')).toContain('SecRuleEngine On');
  });

  it('does not let a newline in mode inject extra directives', () => {
    const out = directives('On\nSecRuleRemoveById 1-999999');
    expect(out).toContain('SecRuleEngine On');
    expect(out).not.toContain('SecRuleRemoveById 1-999999');
  });

  it('always emits the audit log parts the event parser depends on', () => {
    const out = directives('On');
    // Part H carries the matched rules that waf-log-parser reads for rule
    // attribution; losing it silently strips rule id/message/severity.
    expect(out).toContain('SecAuditLogParts ABFHZ');
    expect(out).toContain('SecAuditLog /logs/waf-audit.log');
    expect(out).toContain('SecAuditLogFormat JSON');
  });
});

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
      'SecRequestBodyLimit 536870912',
      'SecRequestBodyNoFilesLimit 536870912',
    ].join('\n');
    const handler = buildWafHandler({ ...baseWaf, custom_directives: directives });
    expect(handler.directives).toContain('SecRequestBodyLimit 536870912');
    expect(handler.directives).toContain('SecRequestBodyNoFilesLimit 536870912');
  });

  // Coraza refuses to build a WAF above 1 GiB, and coraza-caddy builds it while
  // Caddy loads the config — so an out-of-range value doesn't just fail this
  // host, it makes Caddy reject the whole document.
  it('drops body limits Coraza would refuse rather than breaking the config load', () => {
    const handler = buildWafHandler({
      ...baseWaf,
      custom_directives: [
        'SecRequestBodyLimit 10737418240',
        'SecRequestBodyInMemoryLimit 0',
        'SecRequestBodyLimit 536870912',
      ].join('\n'),
    });
    expect(handler.directives).not.toContain('10737418240');
    expect(handler.directives).not.toContain('SecRequestBodyInMemoryLimit 0');
    expect(handler.directives).toContain('SecRequestBodyLimit 536870912');
  });

  it('accepts a body limit exactly at Coraza\'s 1 GiB ceiling', () => {
    const handler = buildWafHandler({
      ...baseWaf,
      custom_directives: `SecRequestBodyLimit ${CORAZA_MAX_BODY_LIMIT}`,
    });
    expect(handler.directives).toContain(`SecRequestBodyLimit ${CORAZA_MAX_BODY_LIMIT}`);
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

// ---------------------------------------------------------------------------
// Dedicated request body limit settings (#252)
//
// Coraza's WAF is built while Caddy loads the config, so every value emitted
// here has to satisfy Coraza's validation up front: <= 1 GiB, and the
// in-memory limit no larger than the request limit. A violation rejects the
// whole config document, leaving every host unapplied.
// ---------------------------------------------------------------------------

describe('buildWafHandler — request body limit settings', () => {
  it('emits the configured limits as SecLang directives', () => {
    const handler = buildWafHandler({
      ...baseWaf,
      request_body_limit: 536870912,
      request_body_in_memory_limit: 1048576,
      request_body_limit_action: 'ProcessPartial',
    });
    const directives = handler.directives as string;
    expect(directives).toContain('SecRequestBodyLimit 536870912');
    expect(directives).toContain('SecRequestBodyInMemoryLimit 1048576');
    expect(directives).toContain('SecRequestBodyLimitAction ProcessPartial');
  });

  it('emits nothing when the limits are unset', () => {
    const directives = buildWafHandler(baseWaf).directives as string;
    expect(directives).not.toContain('SecRequestBodyLimit');
    expect(directives).not.toContain('SecRequestBodyLimitAction');
  });

  it('overrides the CRS default by ordering the limit after the include', () => {
    const directives = buildWafHandler({
      ...baseWaf,
      load_owasp_crs: true,
      request_body_limit: 536870912,
    }).directives as string;
    const includeAt = directives.indexOf('Include @coraza.conf-recommended');
    const limitAt = directives.indexOf('SecRequestBodyLimit 536870912');
    expect(includeAt).toBeGreaterThanOrEqual(0);
    expect(limitAt).toBeGreaterThan(includeAt);
  });

  it('lets custom directives win over the settings fields', () => {
    const directives = buildWafHandler({
      ...baseWaf,
      request_body_limit: 536870912,
      custom_directives: 'SecRequestBodyLimit 268435456',
    }).directives as string;
    expect(directives.indexOf('SecRequestBodyLimit 268435456'))
      .toBeGreaterThan(directives.indexOf('SecRequestBodyLimit 536870912'));
  });

  it('ignores out-of-range and unknown values instead of emitting them', () => {
    const directives = buildWafHandler({
      ...baseWaf,
      request_body_limit: 10737418240,
      request_body_in_memory_limit: 0,
      request_body_limit_action: 'Off' as never,
    }).directives as string;
    expect(directives).not.toContain('SecRequestBodyLimit');
    expect(directives).not.toContain('SecRequestBodyLimitAction');
  });

  // Coraza validates the FINAL values, so the corrective line at the end wins.
  it('clamps an in-memory limit that would exceed the request limit', () => {
    const directives = buildWafHandler({
      ...baseWaf,
      load_owasp_crs: true,
      custom_directives: 'SecRequestBodyInMemoryLimit 268435456',
    }).directives as string;
    // CRS caps the request body at 12.5 MiB, so 256 MiB in memory is invalid.
    expect(directives.trimEnd().endsWith('SecRequestBodyInMemoryLimit 13107200')).toBe(true);
  });

  it('leaves a valid limit pair untouched', () => {
    const directives = buildWafHandler({
      ...baseWaf,
      load_owasp_crs: true,
      request_body_limit: 536870912,
      request_body_in_memory_limit: 268435456,
    }).directives as string;
    expect(directives.match(/SecRequestBodyInMemoryLimit/g)).toHaveLength(1);
  });
});

describe('resolveEffectiveWaf — body limits', () => {
  const globalWaf = {
    enabled: true,
    mode: 'On' as const,
    load_owasp_crs: true,
    custom_directives: '',
    request_body_limit: 134217728,
    request_body_limit_action: 'Reject' as const,
  };

  it('lets a host override the global limit in merge mode', () => {
    const effective = resolveEffectiveWaf(globalWaf, { enabled: true, request_body_limit: 536870912 });
    expect(effective?.request_body_limit).toBe(536870912);
    expect(effective?.request_body_limit_action).toBe('Reject');
  });

  it('inherits the global limit when the host leaves it unset', () => {
    const effective = resolveEffectiveWaf(globalWaf, { enabled: true });
    expect(effective?.request_body_limit).toBe(134217728);
  });

  it('does not inherit the global limit in override mode', () => {
    const effective = resolveEffectiveWaf(globalWaf, { enabled: true, waf_mode: 'override' });
    expect(effective?.request_body_limit).toBeUndefined();
  });
});

describe('findInvalidBodyLimitDirective', () => {
  it('reports the offending line so the user gets a precise error', () => {
    expect(findInvalidBodyLimitDirective('SecRequestBodyLimit 10737418240'))
      .toBe('SecRequestBodyLimit 10737418240');
  });

  it('passes in-range limits, comments and unrelated directives', () => {
    expect(findInvalidBodyLimitDirective([
      '# raise the upload ceiling',
      'SecRequestBodyLimit 536870912',
      'SecRule ARGS "@contains evil" "id:9001,deny"',
    ].join('\n'))).toBeNull();
    expect(findInvalidBodyLimitDirective('')).toBeNull();
    expect(findInvalidBodyLimitDirective(undefined)).toBeNull();
  });
});

describe('parseBodyLimitMib', () => {
  it('converts MiB to bytes and treats blank as unset', () => {
    expect(parseBodyLimitMib('512', 'Limit')).toBe(536870912);
    expect(parseBodyLimitMib('', 'Limit')).toBeUndefined();
    expect(parseBodyLimitMib('  ', 'Limit')).toBeUndefined();
    expect(parseBodyLimitMib(null, 'Limit')).toBeUndefined();
  });

  it('rejects values Coraza would refuse', () => {
    expect(() => parseBodyLimitMib('1025', 'Limit')).toThrow(/between 1 and 1024/);
    expect(() => parseBodyLimitMib('0', 'Limit')).toThrow();
    expect(() => parseBodyLimitMib('1.5', 'Limit')).toThrow();
    expect(() => parseBodyLimitMib('abc', 'Limit')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// filterCustomDirectives
// ---------------------------------------------------------------------------
// The allowlist that guards custom_directives. buildWafHandler must only ever
// emit `kept`. The `dropped` list is what validation surfaces to the user so a
// directive like SecRuleUpdateActionById (discussion #146) fails loudly instead
// of silently doing nothing.

describe('filterCustomDirectives', () => {
  it('keeps plain SecRule, SecAction, SecMarker and SecDefaultAction lines', () => {
    const { kept, dropped } = filterCustomDirectives([
      'SecRule REQUEST_URI "@contains /admin" "id:1001,phase:1,deny"',
      'SecAction "id:1101,phase:1,log"',
      'SecMarker marker1',
      'SecDefaultAction "phase:1,log,pass"',
    ].join('\n'));
    expect(dropped).toEqual([]);
    expect(kept).toHaveLength(4);
  });

  it('drops rule-mutation/engine directives with a reason', () => {
    const { kept, dropped } = filterCustomDirectives('SecRuleUpdateActionById 930130 "block"');
    expect(kept).toEqual([]);
    expect(dropped).toHaveLength(1);
    expect(dropped[0]).toMatchObject({ line: 'SecRuleUpdateActionById 930130 "block"' });
    expect(dropped[0].reason).toMatch(/rule-mutation/);
  });

  it('drops Include directives with a reason', () => {
    const { dropped } = filterCustomDirectives('Include @owasp_crs/*.conf');
    expect(dropped[0].reason).toMatch(/Include is not allowed/);
  });

  it('drops out-of-range body limits but keeps in-range ones', () => {
    const { kept, dropped } = filterCustomDirectives([
      'SecRequestBodyLimit 10737418240',
      'SecRequestBodyLimit 536870912',
    ].join('\n'));
    expect(dropped).toHaveLength(1);
    expect(dropped[0].line).toBe('SecRequestBodyLimit 10737418240');
    expect(kept).toContain('SecRequestBodyLimit 536870912');
  });

  it('drops ctl:ruleEngine even inside an allowed line', () => {
    const { dropped } = filterCustomDirectives('SecAction "id:9001,phase:1,ctl:ruleEngine=Off"');
    expect(dropped).toHaveLength(1);
    expect(dropped[0].reason).toMatch(/ctl:ruleEngine/);
  });

  it('drops rules using operators that read files or run programs', () => {
    const lines = [
      'SecRule FILES_TMPNAMES "@inspectFile /usr/local/bin/scan" "id:9101,deny"',
      'SecRule ARGS "@pmFromFile /etc/hosts" "id:9102,deny"',
      'SecRule ARGS "@pmf words.txt" "id:9103,deny"',
      'SecRule REMOTE_ADDR "!@ipMatchFromFile /data/ips.txt" "id:9104,deny"',
      'SecRule REMOTE_ADDR "@ipMatchF ips.txt" "id:9105,deny"',
      'SecRule REQUEST_BODY "@validateSchema /data/schema.json" "id:9106,deny"',
      'SecRule ARGS "@INSPECTFILE /bin/x" "id:9107,deny"',
    ];
    const { kept, dropped } = filterCustomDirectives(lines.join('\n'));
    expect(kept).toEqual([]);
    expect(dropped).toHaveLength(lines.length);
    for (const item of dropped) expect(item.reason).toMatch(/reads files or runs programs/);
  });

  it('keeps rules whose operators only look similar to file operators', () => {
    const line = 'SecRule ARGS "@pm pmfoo inspectFile" "id:9108,deny"';
    const { kept, dropped } = filterCustomDirectives(line);
    expect(dropped).toEqual([]);
    expect(kept).toEqual([line]);
  });

  it('preserves empty lines and comments', () => {
    const { kept, dropped } = filterCustomDirectives('# comment\n\nSecRule ARGS "@contains evil" "id:9002,deny"');
    expect(dropped).toEqual([]);
    expect(kept).toEqual(['# comment', '', 'SecRule ARGS "@contains evil" "id:9002,deny"']);
  });

  it('returns empty results for blank input', () => {
    expect(filterCustomDirectives('')).toEqual({ kept: [], dropped: [] });
    expect(filterCustomDirectives(undefined)).toEqual({ kept: [], dropped: [] });
  });
});

describe('droppedWafDirectiveMessage', () => {
  it('names each dropped line and its reason', () => {
    const msg = droppedWafDirectiveMessage([
      { line: 'SecRuleUpdateActionById 930130 "block"', reason: 'rule-mutation/engine directives are not allowed' },
    ]);
    expect(msg).toMatch(/will be dropped and never sent to Caddy/);
    expect(msg).toMatch(/SecRuleUpdateActionById 930130 "block"/);
    expect(msg).toMatch(/rule-mutation/);
  });
});
