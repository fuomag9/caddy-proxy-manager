/**
 * Functional tests: L4 (TCP/UDP) proxy routing.
 *
 * Creates real L4 proxy hosts pointing at echo containers,
 * then sends raw TCP connections and UDP datagrams through Caddy
 * and asserts the traffic reaches the upstream.
 *
 * Test ports exposed on the Caddy container:
 *   TCP: 15432, 15433
 *   UDP: 15353
 *
 * Upstream services:
 *   tcp-echo (cjimti/go-echo on port 9000) — echoes TCP data
 *   udp-echo (alpine/socat on port 9001) — echoes UDP datagrams
 */
import { test, expect } from '@playwright/test';
import { createL4ProxyHost } from '../../helpers/l4-proxy-api';
import { tcpSend, waitForTcpRoute, tcpConnect, udpSend, waitForUdpRoute } from '../../helpers/tcp';

const TCP_PORT = 15432;
const TCP_PORT_2 = 15433;
const UDP_PORT = 15353;

// ---------------------------------------------------------------------------
// TCP routing
// ---------------------------------------------------------------------------

test.describe.serial('L4 TCP Proxy Routing', () => {
  test('setup: create TCP proxy host pointing at tcp-echo', async ({ page }) => {
    await createL4ProxyHost(page, {
      name: 'L4 TCP Echo Test',
      protocol: 'tcp',
      listenAddress: `:${TCP_PORT}`,
      upstream: 'tcp-echo:9000',
    });
    await waitForTcpRoute('127.0.0.1', TCP_PORT);
  });

  test('routes TCP traffic to the upstream echo server', async () => {
    const res = await tcpSend('127.0.0.1', TCP_PORT, 'hello from test\n');
    expect(res.connected).toBe(true);
    expect(res.data).toContain('hello from test');
  });

  test('TCP connection is accepted on the L4 port', async () => {
    const connected = await tcpConnect('127.0.0.1', TCP_PORT);
    expect(connected).toBe(true);
  });

  test('unused TCP port does not accept connections', async () => {
    const connected = await tcpConnect('127.0.0.1', TCP_PORT_2, 2000);
    expect(connected).toBe(false);
  });

  test('disabled TCP proxy host stops accepting connections', async ({ page }) => {
    await page.goto('/l4-proxy-hosts');
    const row = page.locator('tr', { hasText: 'L4 TCP Echo Test' });
    await row.locator('input[type="checkbox"]').first().click({ force: true });
    await page.waitForTimeout(3_000);

    const connected = await tcpConnect('127.0.0.1', TCP_PORT, 2000);
    expect(connected).toBe(false);

    // Re-enable
    await row.locator('input[type="checkbox"]').first().click({ force: true });
    await page.waitForTimeout(2_000);
  });
});

test.describe.serial('L4 Multiple TCP Hosts', () => {
  test('setup: create second TCP proxy host on different port', async ({ page }) => {
    await createL4ProxyHost(page, {
      name: 'L4 TCP Echo Test 2',
      protocol: 'tcp',
      listenAddress: `:${TCP_PORT_2}`,
      upstream: 'tcp-echo:9000',
    });
    await waitForTcpRoute('127.0.0.1', TCP_PORT_2);
  });

  test('both TCP ports route traffic independently', async () => {
    const res1 = await tcpSend('127.0.0.1', TCP_PORT, 'port1\n');
    const res2 = await tcpSend('127.0.0.1', TCP_PORT_2, 'port2\n');
    expect(res1.connected).toBe(true);
    expect(res2.connected).toBe(true);
    expect(res1.data).toContain('port1');
    expect(res2.data).toContain('port2');
  });
});

// ---------------------------------------------------------------------------
// UDP routing
// ---------------------------------------------------------------------------

test.describe.serial('L4 UDP Proxy Routing', () => {
  test('setup: create UDP proxy host pointing at udp-echo', async ({ page }) => {
    await createL4ProxyHost(page, {
      name: 'L4 UDP Echo Test',
      protocol: 'udp',
      listenAddress: `:${UDP_PORT}`,
      upstream: 'udp-echo:9001',
    });
    await waitForUdpRoute('127.0.0.1', UDP_PORT);
  });

  test('routes UDP datagrams to the upstream echo server', async () => {
    const res = await udpSend('127.0.0.1', UDP_PORT, 'hello udp');
    expect(res.received).toBe(true);
    expect(res.data).toContain('hello udp');
  });

  test('sends multiple UDP datagrams independently', async () => {
    const res1 = await udpSend('127.0.0.1', UDP_PORT, 'datagram-1');
    const res2 = await udpSend('127.0.0.1', UDP_PORT, 'datagram-2');
    expect(res1.received).toBe(true);
    expect(res2.received).toBe(true);
    expect(res1.data).toContain('datagram-1');
    expect(res2.data).toContain('datagram-2');
  });

  test('disabled UDP proxy host stops responding', async ({ page }) => {
    await page.goto('/l4-proxy-hosts');
    const row = page.locator('tr', { hasText: 'L4 UDP Echo Test' });
    await row.locator('input[type="checkbox"]').first().click({ force: true });
    await page.waitForTimeout(3_000);

    const res = await udpSend('127.0.0.1', UDP_PORT, 'should-fail', 2000);
    expect(res.received).toBe(false);

    // Re-enable
    await row.locator('input[type="checkbox"]').first().click({ force: true });
    await page.waitForTimeout(2_000);
  });
});
