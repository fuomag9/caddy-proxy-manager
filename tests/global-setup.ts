import { execFileSync, execFileSync as runCmd } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const COMPOSE_ARGS = [
  'compose',
  '-f', 'docker-compose.yml',
  '-f', 'tests/docker-compose.test.yml',
];
const HEALTH_URL = 'http://localhost:3000/api/health';
const AUTH_DIR = resolve(process.cwd(), 'tests/.auth');
const AUTH_FILE = resolve(AUTH_DIR, 'admin.json');
const MAX_WAIT_MS = 180_000;
const POLL_INTERVAL_MS = 3_000;

async function waitForHealth(): Promise<void> {
  const start = Date.now();
  let attempt = 0;
  while (Date.now() - start < MAX_WAIT_MS) {
    attempt++;
    try {
      const res = await fetch(HEALTH_URL);
      if (res.status === 200) {
        console.log(`[global-setup] App is healthy (attempt ${attempt})`);
        return;
      }
      console.log(`[global-setup] Health check attempt ${attempt}: HTTP ${res.status}, retrying...`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`[global-setup] Health check attempt ${attempt}: ${msg}, retrying in ${POLL_INTERVAL_MS / 1000}s...`);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  // Dump container logs to help diagnose the failure
  console.error('[global-setup] Health check timed out. Container logs:');
  try {
    execFileSync('docker', [...COMPOSE_ARGS, 'logs', '--tail=50'], { stdio: 'inherit', cwd: process.cwd() });
  } catch { /* ignore */ }

  throw new Error(`App did not become healthy within ${MAX_WAIT_MS}ms`);
}

async function seedAuthState(): Promise<void> {
  console.log('[global-setup] Seeding auth state...');

  // Get CSRF token from NextAuth
  const csrfRes = await fetch('http://localhost:3000/api/auth/csrf');
  if (!csrfRes.ok) {
    throw new Error(`CSRF request failed: ${csrfRes.status}`);
  }
  const csrfData = await csrfRes.json() as { csrfToken: string };
  console.log('[global-setup] Got CSRF token');

  const params = new URLSearchParams({
    csrfToken: csrfData.csrfToken,
    username: 'testadmin',
    password: 'TestPassword2026!',  // matches ADMIN_PASSWORD in docker-compose.test.yml
    callbackUrl: 'http://localhost:3000',
    json: 'true',
  });

  const signinRes = await fetch('http://localhost:3000/api/auth/callback/credentials', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: csrfRes.headers.get('set-cookie') ?? '',
    },
    body: params.toString(),
    redirect: 'manual',
  });

  console.log(`[global-setup] Sign-in response: HTTP ${signinRes.status}`);

  // Collect cookies from both responses
  const allCookieHeaders: string[] = [];
  for (const [k, v] of csrfRes.headers.entries()) {
    if (k === 'set-cookie') allCookieHeaders.push(v);
  }
  for (const [k, v] of signinRes.headers.entries()) {
    if (k === 'set-cookie') allCookieHeaders.push(v);
  }

  const cookies = allCookieHeaders.flatMap((header) =>
    header.split(/,(?=[^ ])/).map((cookie) => {
      const parts = cookie.split(';').map((p) => p.trim());
      const [nameVal, ...attrs] = parts;
      const eqIdx = nameVal.indexOf('=');
      if (eqIdx === -1) return null;
      const name = nameVal.slice(0, eqIdx);
      const value = nameVal.slice(eqIdx + 1);
      const attrMap: Record<string, string | boolean> = {};
      for (const attr of attrs) {
        const [k, v] = attr.split('=').map((s) => s.trim());
        attrMap[k.toLowerCase()] = v ?? true;
      }
      return {
        name,
        value,
        domain: 'localhost',
        path: typeof attrMap['path'] === 'string' ? attrMap['path'] : '/',
        httpOnly: attrMap['httponly'] === true,
        secure: attrMap['secure'] === true,
        sameSite: typeof attrMap['samesite'] === 'string'
          ? attrMap['samesite'].charAt(0).toUpperCase() + attrMap['samesite'].slice(1).toLowerCase()
          : 'Lax',
      };
    }).filter(Boolean)
  );

  console.log(`[global-setup] Collected ${cookies.length} cookies`);

  const storageState = { cookies, origins: [] };
  mkdirSync(AUTH_DIR, { recursive: true });
  writeFileSync(AUTH_FILE, JSON.stringify(storageState, null, 2));
  console.log('[global-setup] Auth state saved to', AUTH_FILE);
}

export default async function globalSetup() {
  console.log('[global-setup] Starting Docker Compose test stack...');
  execFileSync('docker', [
    ...COMPOSE_ARGS,
    'up', '-d', '--build',
    '--wait', '--wait-timeout', '120',
  ], {
    stdio: 'inherit',
    cwd: process.cwd(),
  });

  console.log('[global-setup] Containers up. Waiting for /api/health...');
  await waitForHealth();
  await seedAuthState();

  console.log('[global-setup] Done.');
}
