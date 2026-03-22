/**
 * Higher-level helpers for creating L4 proxy hosts in E2E tests.
 *
 * All helpers accept a Playwright `Page` (pre-authenticated via the
 * global storageState) so they integrate cleanly with the standard
 * `page` test fixture.
 */
import { expect, type Page } from '@playwright/test';

export interface L4ProxyHostConfig {
  name: string;
  protocol?: 'tcp' | 'udp';
  listenAddress: string;
  upstream: string;          // e.g. "tcp-echo:9000"
  matcherType?: 'none' | 'tls_sni' | 'http_host' | 'proxy_protocol';
  matcherValue?: string;     // comma-separated
  tlsTermination?: boolean;
  proxyProtocolReceive?: boolean;
  proxyProtocolVersion?: 'v1' | 'v2';
}

/**
 * Create an L4 proxy host via the browser UI.
 */
export async function createL4ProxyHost(page: Page, config: L4ProxyHostConfig): Promise<void> {
  await page.goto('/l4-proxy-hosts');
  await page.getByRole('button', { name: /create l4 host/i }).click();
  await expect(page.getByRole('dialog')).toBeVisible();

  await page.getByLabel('Name').fill(config.name);

  // Protocol select (shadcn Select renders a button with role="combobox")
  if (config.protocol && config.protocol !== 'tcp') {
    await page.getByRole('combobox', { name: 'Protocol' }).first().click();
    await page.getByRole('option', { name: new RegExp(config.protocol, 'i') }).click();
  }

  await page.getByLabel('Listen Address').fill(config.listenAddress);
  await page.getByLabel('Upstreams').fill(config.upstream);

  // Matcher type
  if (config.matcherType && config.matcherType !== 'none') {
    await page.getByLabel('Matcher').click();
    const matcherLabels: Record<string, RegExp> = {
      tls_sni: /tls sni/i,
      http_host: /http host/i,
      proxy_protocol: /proxy protocol/i,
    };
    await page.getByRole('option', { name: matcherLabels[config.matcherType] }).click();

    if (config.matcherValue && (config.matcherType === 'tls_sni' || config.matcherType === 'http_host')) {
      await page.getByLabel(/hostnames/i).fill(config.matcherValue);
    }
  }

  // TLS termination
  if (config.tlsTermination) {
    await page.getByLabel(/tls termination/i).check();
  }

  // Proxy protocol receive
  if (config.proxyProtocolReceive) {
    await page.getByLabel(/accept inbound proxy/i).check();
  }

  // Proxy protocol version
  if (config.proxyProtocolVersion) {
    await page.getByLabel(/send proxy protocol/i).click();
    await page.getByRole('option', { name: config.proxyProtocolVersion }).click();
  }

  // Submit
  await page.getByRole('button', { name: /create/i }).click();

  // Wait for success state (dialog closes or success alert)
  await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10_000 });

  // Verify host appears in the table
  await expect(page.getByRole('table').getByText(config.name)).toBeVisible({ timeout: 10_000 });
}
