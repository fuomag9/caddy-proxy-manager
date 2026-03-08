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
import { buildWafHandler } from '../../src/lib/caddy-waf';

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
