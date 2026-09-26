/**
 * The forward-auth portal must not offer a login form that can only fail:
 * a protected site on an undeclared port gets an explanation naming
 * FORWARD_AUTH_ALLOWED_PORTS, and repeated rd/rid parameters are rejected.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const fa = vi.hoisted(() => ({
  isForwardAuthDomain: vi.fn(),
  createRedirectIntent: vi.fn(),
  getDisallowedForwardAuthPort: vi.fn(),
}));

vi.mock('@/src/lib/auth', () => ({ auth: vi.fn().mockResolvedValue(null) }));
vi.mock('@/src/lib/models/oauth-providers', () => ({ getProviderDisplayList: vi.fn().mockResolvedValue([]) }));
vi.mock('@/src/lib/models/forward-auth', () => fa);
vi.mock('@/src/lib/auth-client', () => ({ authClient: { signIn: { social: vi.fn() } } }));

import PortalPage from '@/app/(auth)/portal/page';
import PortalLoginForm from '@/app/(auth)/portal/PortalLoginForm';

type FormProps = Parameters<typeof PortalLoginForm>[0];

async function renderPortal(searchParams: Record<string, string | string[]>) {
  const element = (await PortalPage({ searchParams: Promise.resolve(searchParams) })) as { props: FormProps };
  return { props: element.props, html: renderToStaticMarkup(createElement(PortalLoginForm, element.props)) };
}

beforeEach(() => {
  vi.clearAllMocks();
  fa.isForwardAuthDomain.mockResolvedValue(true);
  fa.getDisallowedForwardAuthPort.mockResolvedValue(null);
  fa.createRedirectIntent.mockResolvedValue('rid-from-intent');
});

describe('portal page', () => {
  it('creates a redirect intent and shows the login form for a valid target', async () => {
    const { props, html } = await renderPortal({ rd: 'https://app.example.com/path?a=1&b=2' });
    expect(fa.createRedirectIntent).toHaveBeenCalledWith('https://app.example.com/path?a=1&b=2');
    expect(props.rid).toBe('rid-from-intent');
    expect(props.errorMessage).toBeNull();
    expect(html).toContain('type="password"');
  });

  it('explains an undeclared port instead of showing a login form', async () => {
    fa.getDisallowedForwardAuthPort.mockResolvedValue('8443');
    const { props, html } = await renderPortal({ rd: 'https://app.example.com:8443/' });

    expect(fa.createRedirectIntent).not.toHaveBeenCalled();
    expect(props.rid).toBe('');
    expect(props.targetDomain).toBe('app.example.com');
    expect(props.errorMessage).toContain('port 8443');
    expect(props.errorMessage).toContain('FORWARD_AUTH_ALLOWED_PORTS');
    expect(html).toContain('FORWARD_AUTH_ALLOWED_PORTS');
    expect(html).not.toContain('type="password"');
  });

  it.each([
    ['repeated rd', { rd: ['https://app.example.com/', 'https://other.example.com/'] }],
    ['repeated rid', { rid: ['a'.repeat(32), 'b'.repeat(32)] }],
    ['rd with repeated rid', { rd: 'https://app.example.com/', rid: ['a'.repeat(32), 'b'.repeat(32)] }],
  ])('rejects a %s', async (_name, searchParams) => {
    const { props, html } = await renderPortal(searchParams);
    expect(fa.createRedirectIntent).not.toHaveBeenCalled();
    expect(props.rid).toBe('');
    expect(props.hasRedirect).toBe(true);
    expect(props.errorMessage).toMatch(/invalid/i);
    expect(html).not.toContain('type="password"');
  });

  it('keeps the OAuth return flow working with a single rid', async () => {
    const { props } = await renderPortal({ rid: 'c'.repeat(32) });
    expect(props.rid).toBe('c'.repeat(32));
    expect(props.errorMessage).toBeNull();
  });
});
