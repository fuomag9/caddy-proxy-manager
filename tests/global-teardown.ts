import { execFileSync } from 'node:child_process';
import { rmSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const COMPOSE_ARGS = [
  'compose',
  '-f', 'docker-compose.yml',
  '-f', 'tests/docker-compose.test.yml',
];

export default async function globalTeardown() {
  console.log('[global-teardown] Stopping Docker Compose test stack...');
  try {
    execFileSync('docker', [...COMPOSE_ARGS, 'down', '-v', '--remove-orphans'], {
      stdio: 'inherit',
      cwd: process.cwd(),
    });
  } catch (err) {
    console.warn('[global-teardown] docker compose down failed:', err);
  }

  const authDir = resolve(__dirname, '.auth');
  if (existsSync(authDir)) {
    rmSync(authDir, { recursive: true, force: true });
    console.log('[global-teardown] Removed', authDir);
  }

  console.log('[global-teardown] Done.');
}
