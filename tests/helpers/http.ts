/**
 * Low-level HTTP helper for functional tests.
 *
 * Sends requests directly to Caddy on port 80 using a custom Host header,
 * bypassing DNS so test domains don't need to be resolvable.
 */
import http from 'node:http';
import type { Page } from '@playwright/test';

export interface HttpResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

/** Make an HTTP request to Caddy (localhost:80) with a custom Host header. */
export function httpGet(domain: string, path = '/', extraHeaders: Record<string, string> = {}): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: 80,
        path,
        method: 'GET',
        headers: { Host: domain, ...extraHeaders },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        res.on('end', () =>
          resolve({ status: res.statusCode!, headers: res.headers as HttpResponse['headers'], body })
        );
      }
    );
    req.on('error', reject);
    req.end();
  });
}

/**
 * Poll until the route responds with a status other than 502/503/504
 * (which Caddy returns while the config reload is in-flight or the
 * upstream hasn't been wired up yet).
 */
export async function waitForRoute(domain: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = 0;
  while (Date.now() < deadline) {
    try {
      const res = await httpGet(domain);
      lastStatus = res.status;
      if (res.status !== 502 && res.status !== 503 && res.status !== 504) return;
    } catch {
      // Connection refused — Caddy not ready yet
    }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`Route for "${domain}" not ready after ${timeoutMs}ms (last status: ${lastStatus})`);
}

/**
 * Poll until the route returns a specific expected status code.
 * Useful for forward auth routes where you expect 302 (redirect to portal).
 */
export async function waitForStatus(domain: string, expectedStatus: number, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = 0;
  while (Date.now() < deadline) {
    try {
      const res = await httpGet(domain);
      lastStatus = res.status;
      if (res.status === expectedStatus) return;
    } catch {
      // Connection refused — not ready yet
    }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`Route for "${domain}" did not return ${expectedStatus} after ${timeoutMs}ms (last status: ${lastStatus})`);
}

/** Inject hidden form fields into #create-host-form before submitting. */
export async function injectFormFields(page: Page, fields: Record<string, string>): Promise<void> {
  await page.evaluate((f) => {
    const form = document.getElementById('create-host-form');
    if (!form) throw new Error('create-host-form not found');
    for (const [name, value] of Object.entries(f)) {
      const existing = form.querySelector<HTMLInputElement>(`input[name="${name}"]`);
      if (existing) {
        existing.value = value;
      } else {
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = name;
        input.value = value;
        form.appendChild(input);
      }
    }
  }, fields);
}
