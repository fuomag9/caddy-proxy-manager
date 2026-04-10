/**
 * E2E tests: Docker container health.
 *
 * Verifies that all containers in the test stack are running and healthy.
 * Catches issues like permission errors, missing dependencies, or
 * misconfigured Dockerfiles that cause sidecar containers to crash-loop.
 */
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';

const COMPOSE_ARGS = [
  'compose',
  '-f', 'docker-compose.yml',
  '-f', 'tests/docker-compose.test.yml',
];

type ContainerInfo = {
  name: string;
  state: string;
  health?: string;
};

function getContainers(): ContainerInfo[] {
  const output = execFileSync('docker', [
    ...COMPOSE_ARGS,
    'ps', '--format', 'json', '-a',
  ], {
    cwd: process.cwd(),
    env: { ...process.env, CLICKHOUSE_PASSWORD: 'test-clickhouse-password-2026' },
    encoding: 'utf-8',
  });

  // docker compose ps --format json outputs one JSON object per line
  return output
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const c = JSON.parse(line);
      return {
        name: c.Name ?? c.Service,
        state: (c.State ?? '').toLowerCase(),
        health: (c.Health ?? '').toLowerCase() || undefined,
      };
    });
}

test.describe('Container health', () => {
  let containers: ContainerInfo[];

  test.beforeAll(() => {
    containers = getContainers();
  });

  test('all containers are running', () => {
    expect(containers.length).toBeGreaterThan(0);
    for (const c of containers) {
      expect(
        c.state,
        `Container "${c.name}" is not running (state: ${c.state})`
      ).toBe('running');
    }
  });

  test('web container is healthy', () => {
    const web = containers.find((c) => c.name.includes('web'));
    expect(web, 'web container not found').toBeTruthy();
    expect(web!.health, `web container health: ${web!.health}`).toBe('healthy');
  });

  test('caddy container is healthy', () => {
    const caddy = containers.find((c) => c.name.includes('caddy') && !c.name.includes('proxy-manager-web'));
    expect(caddy, 'caddy container not found').toBeTruthy();
    expect(caddy!.health, `caddy container health: ${caddy!.health}`).toBe('healthy');
  });

  test('clickhouse container is healthy', () => {
    const ch = containers.find((c) => c.name.includes('clickhouse'));
    expect(ch, 'clickhouse container not found').toBeTruthy();
    expect(ch!.health, `clickhouse container health: ${ch!.health}`).toBe('healthy');
  });

  test('l4-port-manager container is running (not crash-looping)', () => {
    const l4 = containers.find((c) => c.name.includes('l4-ports') || c.name.includes('l4-port-manager'));
    expect(l4, 'l4-port-manager container not found').toBeTruthy();
    expect(l4!.state, `l4-port-manager state: ${l4!.state}`).toBe('running');

    // Verify it hasn't restarted (restart count > 0 means crash-loop)
    const inspect = execFileSync('docker', [
      'inspect', '--format', '{{.RestartCount}}', l4!.name,
    ], { encoding: 'utf-8' }).trim();
    const restartCount = Number(inspect);
    expect(
      restartCount,
      `l4-port-manager has restarted ${restartCount} time(s) — likely crash-looping`
    ).toBe(0);
  });
});
