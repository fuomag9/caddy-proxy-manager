import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..');

export default defineConfig({
  plugins: [tsconfigPaths({ root })],
  test: {
    environment: 'node',
    setupFiles: [resolve(__dirname, 'setup.vitest.ts')],
    env: {
      DATABASE_URL: ':memory:',
      SESSION_SECRET: 'test-session-secret-for-vitest-unit-tests-12345',
      NODE_ENV: 'test',
    },
    include: [
      resolve(__dirname, 'unit/**/*.test.ts'),
      resolve(__dirname, 'integration/**/*.test.ts'),
    ],
    // Suppress console output from production code during tests (e.g. expected
    // warn/error calls when intentionally feeding bad input to parsers).
    // Tests that need to assert on console calls can still use vi.spyOn(console, ...).
    onConsoleLog() {
      return false;
    },
  },
});
