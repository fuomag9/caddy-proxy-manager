import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'node:path';

export default defineConfig({
  testDir: './e2e',
  globalSetup: './global-setup.ts',
  globalTeardown: './global-teardown.ts',
  fullyParallel: false,
  workers: 2,
  retries: 0,
  timeout: 60_000, // functional tests need time for Caddy reloads
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3000',
    storageState: resolve(__dirname, '.auth/admin.json'),
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-iphone',
      use: { ...devices['iPhone 15'] },
    },
  ],
});
