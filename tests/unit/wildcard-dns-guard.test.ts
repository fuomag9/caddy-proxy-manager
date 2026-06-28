import { describe, it, expect, vi, beforeEach } from 'vitest';

// The model module imports caddy/audit; keep those inert for this unit test.
vi.mock('@/src/lib/caddy', () => ({ applyCaddyConfig: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock('@/src/lib/audit', () => ({ logAuditEvent: vi.fn() }));

vi.mock('@/src/lib/settings', async (orig) => {
  const actual = await orig<typeof import('@/src/lib/settings')>();
  return { ...actual, getDnsProviderSettings: vi.fn() };
});

import { assertWildcardIssuable } from '@/src/lib/models/proxy-hosts';
import { getDnsProviderSettings } from '@/src/lib/settings';

const mockGetDnsProviderSettings = vi.mocked(getDnsProviderSettings);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('assertWildcardIssuable', () => {
  it('rejects an auto-managed wildcard host when no DNS provider is configured', async () => {
    mockGetDnsProviderSettings.mockResolvedValue(null);
    await expect(assertWildcardIssuable(['*.example.com'], null)).rejects.toThrow(
      /Wildcard domain "\*\.example\.com" requires a DNS provider/
    );
  });

  it('rejects when a default is named but has no credentials', async () => {
    mockGetDnsProviderSettings.mockResolvedValue({ providers: {}, default: 'cloudflare' });
    await expect(assertWildcardIssuable(['*.example.com'], null)).rejects.toThrow(/DNS provider/);
  });

  it('allows an auto-managed wildcard host when a DNS provider is configured', async () => {
    mockGetDnsProviderSettings.mockResolvedValue({
      providers: { cloudflare: { api_token: 'x' } },
      default: 'cloudflare',
    });
    await expect(assertWildcardIssuable(['*.example.com'], null)).resolves.toBeUndefined();
  });

  it('skips the check entirely for non-wildcard domains', async () => {
    await assertWildcardIssuable(['app.example.com', 'example.com'], null);
    expect(mockGetDnsProviderSettings).not.toHaveBeenCalled();
  });

  it('skips the check when a certificate is explicitly assigned', async () => {
    await assertWildcardIssuable(['*.example.com'], 5);
    expect(mockGetDnsProviderSettings).not.toHaveBeenCalled();
  });
});
