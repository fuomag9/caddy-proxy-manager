/**
 * The WAF page's global settings form must reject custom directives that would
 * be dropped from the generated config, with the same message as the per-host
 * and REST paths, instead of reporting success for rules that never apply.
 * Only what a save newly drops counts, so a stored rule a later release
 * started dropping doesn't block saving other fields.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { WafSettings } from '@/src/lib/settings';

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('@/src/lib/auth', () => ({
  requireAdmin: vi.fn(async () => ({ user: { id: '1' } })),
}));

const { getWafSettingsMock, saveWafSettingsMock, applyCaddyConfigMock } = vi.hoisted(() => ({
  getWafSettingsMock: vi.fn<() => Promise<WafSettings | null>>(async () => null),
  saveWafSettingsMock: vi.fn<(settings: WafSettings) => Promise<void>>(async () => {}),
  applyCaddyConfigMock: vi.fn(async () => ({ ok: true })),
}));

vi.mock('@/src/lib/settings', () => ({
  clearSetting: vi.fn(),
  getSetting: vi.fn(),
  saveCloudflareSettings: vi.fn(),
  getDnsProviderSettings: vi.fn(),
  saveDnsProviderSettings: vi.fn(),
  saveGeneralSettings: vi.fn(),
  saveAuthentikSettings: vi.fn(),
  saveMetricsSettings: vi.fn(),
  saveLoggingSettings: vi.fn(),
  saveDnsSettings: vi.fn(),
  saveUpstreamDnsResolutionSettings: vi.fn(),
  saveGeoBlockSettings: vi.fn(),
  saveWafSettings: saveWafSettingsMock,
  getWafSettings: getWafSettingsMock,
}));
vi.mock('@/src/lib/caddy', () => ({ applyCaddyConfig: applyCaddyConfigMock }));
vi.mock('@/src/lib/models/proxy-hosts', () => ({
  listProxyHosts: vi.fn(),
  updateProxyHost: vi.fn(),
  sanitizeErrorPageRules: vi.fn(),
}));
vi.mock('@/src/lib/instance-sync', () => ({
  getInstanceMode: vi.fn(),
  getSlaveMasterToken: vi.fn(),
  setInstanceMode: vi.fn(),
  setSlaveMasterToken: vi.fn(),
  syncInstances: vi.fn(),
}));
vi.mock('@/src/lib/models/instances', () => ({
  createInstance: vi.fn(),
  deleteInstance: vi.fn(),
  updateInstance: vi.fn(),
}));
vi.mock('@/src/lib/models/waf-events', () => ({
  getWafRuleMessages: vi.fn(),
}));
vi.mock('@/src/lib/dns-providers', () => ({
  getProviderDefinition: vi.fn(),
  encryptProviderCredentials: vi.fn(),
  isValidDnsDuration: vi.fn(),
}));

import { updateWafSettingsAction } from '@/app/(dashboard)/settings/actions';

const DROPPED_RULE = 'SecRule ARGS "@pmFromFile /etc/hosts" "id:1,deny"';

function wafForm(customDirectives: string, extra: Record<string, string> = {}): FormData {
  const form = new FormData();
  form.set('wafEnabled', 'on');
  form.set('wafCustomDirectives', customDirectives);
  form.set('wafExcludedRuleIds', '[]');
  for (const [key, value] of Object.entries(extra)) form.set(key, value);
  return form;
}

beforeEach(() => {
  getWafSettingsMock.mockReset();
  getWafSettingsMock.mockResolvedValue(null);
  saveWafSettingsMock.mockClear();
  applyCaddyConfigMock.mockClear();
});

describe('updateWafSettingsAction custom directives', () => {
  it('rejects a directive that would be dropped and saves nothing', async () => {
    const result = await updateWafSettingsAction(null, wafForm(DROPPED_RULE));

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/will be dropped and never sent to Caddy/);
    expect(result.message).toContain(DROPPED_RULE);
    expect(result.message).toMatch(/pmFromFile is not allowed/);
    expect(saveWafSettingsMock).not.toHaveBeenCalled();
    expect(applyCaddyConfigMock).not.toHaveBeenCalled();
  });

  it('rejects an out-of-range body limit directive', async () => {
    const result = await updateWafSettingsAction(null, wafForm('SecRequestBodyLimit 10737418240'));

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/out-of-range body limit/);
    expect(saveWafSettingsMock).not.toHaveBeenCalled();
  });

  it('saves directives that are all kept', async () => {
    const rule = 'SecRule ARGS "@contains evil" "id:2,deny"';
    const result = await updateWafSettingsAction(null, wafForm(rule));

    expect(result.success).toBe(true);
    expect(saveWafSettingsMock).toHaveBeenCalledWith(expect.objectContaining({ custom_directives: rule }));
  });

  it('checks embedded CRS data-file rules against the submitted CRS setting', async () => {
    const rule = 'SecRule ARGS "@pmf @owasp_crs/unix-shell.data" "id:3,deny"';

    const withoutCrs = await updateWafSettingsAction(null, wafForm(rule));
    expect(withoutCrs.success).toBe(false);
    expect(withoutCrs.message).toMatch(/OWASP CRS is loaded/);

    const withCrs = await updateWafSettingsAction(null, wafForm(rule, { wafLoadOwaspCrs: 'on' }));
    expect(withCrs.success).toBe(true);
  });

  it('does not block saving other fields when the stored directives are unchanged', async () => {
    getWafSettingsMock.mockResolvedValue({
      enabled: true,
      mode: 'On',
      load_owasp_crs: false,
      custom_directives: DROPPED_RULE,
      excluded_rule_ids: [],
    });

    const result = await updateWafSettingsAction(null, wafForm(DROPPED_RULE, { wafLoadOwaspCrs: 'on' }));

    expect(result.success).toBe(true);
    expect(saveWafSettingsMock).toHaveBeenCalledWith(
      expect.objectContaining({ custom_directives: DROPPED_RULE, load_owasp_crs: true })
    );
  });

  it('still rejects a line newly added next to the stored dropped one', async () => {
    getWafSettingsMock.mockResolvedValue({
      enabled: true,
      mode: 'On',
      load_owasp_crs: false,
      custom_directives: DROPPED_RULE,
      excluded_rule_ids: [],
    });
    const added = 'Include /etc/passwd';

    const result = await updateWafSettingsAction(null, wafForm(`${DROPPED_RULE}\n${added}`));

    expect(result.success).toBe(false);
    expect(result.message).toContain(added);
    expect(result.message).toMatch(/contains 1 line\(s\)/);
    expect(saveWafSettingsMock).not.toHaveBeenCalled();
  });

  it('rejects turning the CRS off under an unchanged rule that reads an embedded CRS data file', async () => {
    const rule = 'SecRule ARGS "@pmf @owasp_crs/unix-shell.data" "id:4,deny"';
    getWafSettingsMock.mockResolvedValue({
      enabled: true,
      mode: 'On',
      load_owasp_crs: true,
      custom_directives: rule,
      excluded_rule_ids: [],
    });

    const result = await updateWafSettingsAction(null, wafForm(rule));

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/OWASP CRS is loaded/);
    expect(saveWafSettingsMock).not.toHaveBeenCalled();
  });
});
