import { chromium } from '@playwright/test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const COMPOSE_ARGS = [
  'compose',
  '-f', 'docker-compose.yml',
  '-f', 'tests/docker-compose.test.yml',
];
const HEALTH_URL = 'http://localhost:3000/api/health';
export const AUTH_DIR = resolve(__dirname, '.auth');
export const AUTH_FILE = resolve(AUTH_DIR, 'admin.json');
const MAX_WAIT_MS = 180_000;
const POLL_INTERVAL_MS = 3_000;
const ENV = { ...process.env, CLICKHOUSE_PASSWORD: 'test-clickhouse-password-2026' };

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

  console.error('[global-setup] Health check timed out. Container logs:');
  try {
    execFileSync('docker', [...COMPOSE_ARGS, 'logs', '--tail=50'], { stdio: 'inherit', cwd: process.cwd(), env: ENV });
  } catch { /* ignore */ }

  throw new Error(`App did not become healthy within ${MAX_WAIT_MS}ms`);
}

/**
 * Wait for Caddy to be healthy according to Docker's health status.
 *
 * The l4-port-manager runs `docker compose up --force-recreate caddy` on
 * startup if an L4 port override file is already present (e.g. left over from
 * a previous run whose teardown was interrupted).  `docker compose up --wait`
 * may return before that startup apply completes, so we poll explicitly here
 * to ensure Caddy is stable before tests begin.
 */
async function waitForCaddyHealthy(): Promise<void> {
  const start = Date.now();
  const maxWait = 90_000;
  console.log('[global-setup] Verifying Caddy is healthy...');
  while (Date.now() - start < maxWait) {
    const result = spawnSync('docker', ['inspect', '--format={{.State.Health.Status}}', 'caddy-proxy-manager-caddy'], {
      encoding: 'utf-8',
      cwd: process.cwd(),
    });
    if (result.status === 0 && result.stdout.trim() === 'healthy') {
      console.log('[global-setup] Caddy is healthy.');
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  console.warn('[global-setup] Caddy health wait timed out — proceeding anyway.');
}

async function seedAuthState(): Promise<void> {
  console.log('[global-setup] Seeding auth state via browser login...');
  mkdirSync(AUTH_DIR, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage();

  try {
    await page.goto('http://localhost:3000/login');
    await page.getByRole('textbox', { name: /username/i }).fill('testadmin');
    await page.getByRole('textbox', { name: /password/i }).fill('TestPassword2026!');
    await page.getByRole('button', { name: /sign in/i }).click();

    // Wait for redirect away from /login
    await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15_000 });
    console.log(`[global-setup] Login succeeded, landed on: ${page.url()}`);

    await page.context().storageState({ path: AUTH_FILE });
    console.log('[global-setup] Auth state saved to', AUTH_FILE);
  } finally {
    await browser.close();
  }
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
    env: { ...process.env, CLICKHOUSE_PASSWORD: 'test-clickhouse-password-2026' },
  });

  console.log('[global-setup] Containers up. Waiting for /api/health...');
  await waitForHealth();
  await waitForCaddyHealthy();
  await seedAuthState();

  console.log('[global-setup] Done.');
}
