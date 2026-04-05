/**
 * E2E tests: Role-based access control.
 *
 * Verifies that:
 * - Non-admin users (user, viewer) CAN access / and /profile
 * - Non-admin users CANNOT access admin-only pages
 * - Unauthenticated users are redirected to /login everywhere
 * - Admin users can access all pages
 *
 * Test setup:
 * - Creates "testuser" (role=user) and "testviewer" (role=viewer) in the database
 *   via `docker compose exec` + bun script inside the web container.
 * - Logs in as each role in separate browser contexts.
 */
import { test, expect, type BrowserContext } from '@playwright/test';
import { execFileSync } from 'node:child_process';

const COMPOSE_ARGS = [
  'compose',
  '-f', 'docker-compose.yml',
  '-f', 'tests/docker-compose.test.yml',
];

// Pages that require admin role (via requireAdmin in their own page.tsx)
const ADMIN_ONLY_PAGES = [
  '/proxy-hosts',
  '/l4-proxy-hosts',
  '/certificates',
  '/access-lists',
  '/analytics',
  '/waf',
  '/audit-log',
  '/settings',
  '/users',
  '/groups',
  '/api-docs',
];

// Pages accessible to any authenticated user
const USER_ACCESSIBLE_PAGES = [
  '/',
  '/profile',
];

// All dashboard pages (union of both sets)
const ALL_DASHBOARD_PAGES = [...USER_ACCESSIBLE_PAGES, ...ADMIN_ONLY_PAGES];

/**
 * Create a test user inside the running web container using bun.
 * Uses Bun's built-in Bun.password.hash (bcrypt) — no npm deps needed.
 */
function ensureTestUser(username: string, password: string, role: string) {
  const script = `
    import { Database } from "bun:sqlite";
    const db = new Database("./data/caddy-proxy-manager.db");
    const email = "${username}@localhost";
    const hash = await Bun.password.hash("${password}", { algorithm: "bcrypt", cost: 12 });
    const now = new Date().toISOString();
    const existing = db.query("SELECT id FROM users WHERE email = ?").get(email);
    if (existing) {
      db.run("UPDATE users SET password_hash = ?, role = ?, status = 'active', updated_at = ? WHERE email = ?",
        [hash, "${role}", now, email]);
    } else {
      db.run(
        "INSERT INTO users (email, name, password_hash, role, provider, subject, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'credentials', ?, 'active', ?, ?)",
        [email, "${username}", hash, "${role}", "${username}", now, now]
      );
    }
  `;
  execFileSync('docker', [...COMPOSE_ARGS, 'exec', '-T', 'web', 'bun', '-e', script], {
    cwd: process.cwd(),
    stdio: 'pipe',
  });
}

/**
 * Log in as the given user and return an authenticated browser context.
 */
async function loginAs(
  browser: import('@playwright/test').Browser,
  username: string,
  password: string
): Promise<BrowserContext> {
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto('http://localhost:3000/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();

  // The login client does router.replace('/') on success — wait for that
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 30_000 });
  await page.close();
  return context;
}

// ── Unauthenticated access ────────────────────────────────────────────────

test.describe('Unauthenticated access', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  for (const path of ALL_DASHBOARD_PAGES) {
    test(`${path} redirects to /login`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
    });
  }
});

// ── Role-based access ─────────────────────────────────────────────────────

test.describe('Role-based access control', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  let userContext: BrowserContext;
  let viewerContext: BrowserContext;

  test.beforeAll(async ({ browser }) => {
    // Create test users with non-admin roles
    ensureTestUser('testuser', 'TestUserPass2026!', 'user');
    ensureTestUser('testviewer', 'TestViewerPass2026!', 'viewer');

    // Log in as each role
    userContext = await loginAs(browser, 'testuser', 'TestUserPass2026!');
    viewerContext = await loginAs(browser, 'testviewer', 'TestViewerPass2026!');
  });

  test.afterAll(async () => {
    await userContext?.close();
    await viewerContext?.close();
  });

  // ── "user" role — can access / and /profile ─────────────────────────

  test('user role: / loads with welcome message', async () => {
    const page = await userContext.newPage();
    try {
      await page.goto('/');
      await expect(page).not.toHaveURL(/\/login/, { timeout: 10_000 });
      await expect(page.getByText(/welcome back/i)).toBeVisible({ timeout: 5_000 });
    } finally {
      await page.close();
    }
  });

  test('user role: / does not show admin stat cards', async () => {
    const page = await userContext.newPage();
    try {
      await page.goto('/');
      await expect(page.getByText(/welcome back/i)).toBeVisible({ timeout: 5_000 });
      // Non-admin gets empty stats — no Proxy Hosts / Certificates / Access Lists cards
      await expect(page.getByRole('link', { name: /proxy hosts/i })).not.toBeVisible({ timeout: 3_000 });
    } finally {
      await page.close();
    }
  });

  test('user role: sidebar only shows Overview', async () => {
    const page = await userContext.newPage();
    try {
      await page.goto('/');
      await expect(page.getByText(/welcome back/i)).toBeVisible({ timeout: 5_000 });
      // Overview should be in the nav
      await expect(page.getByRole('link', { name: 'Overview' })).toBeVisible();
      // Admin-only nav items should not be visible
      await expect(page.getByRole('link', { name: 'Proxy Hosts' })).not.toBeVisible();
      await expect(page.getByRole('link', { name: 'Settings' })).not.toBeVisible();
      await expect(page.getByRole('link', { name: 'Users' })).not.toBeVisible();
    } finally {
      await page.close();
    }
  });

  test('user role: /profile loads successfully', async () => {
    const page = await userContext.newPage();
    try {
      await page.goto('/profile');
      await expect(page).not.toHaveURL(/\/login/, { timeout: 10_000 });
      await expect(page.getByText(/profile|password/i).first()).toBeVisible({ timeout: 5_000 });
    } finally {
      await page.close();
    }
  });

  // ── "viewer" role — can access / and /profile ───────────────────────

  test('viewer role: / loads with welcome message', async () => {
    const page = await viewerContext.newPage();
    try {
      await page.goto('/');
      await expect(page).not.toHaveURL(/\/login/, { timeout: 10_000 });
      await expect(page.getByText(/welcome back/i)).toBeVisible({ timeout: 5_000 });
    } finally {
      await page.close();
    }
  });

  test('viewer role: / does not show admin stat cards', async () => {
    const page = await viewerContext.newPage();
    try {
      await page.goto('/');
      await expect(page.getByText(/welcome back/i)).toBeVisible({ timeout: 5_000 });
      await expect(page.getByRole('link', { name: /proxy hosts/i })).not.toBeVisible({ timeout: 3_000 });
    } finally {
      await page.close();
    }
  });

  test('viewer role: sidebar only shows Overview', async () => {
    const page = await viewerContext.newPage();
    try {
      await page.goto('/');
      await expect(page.getByText(/welcome back/i)).toBeVisible({ timeout: 5_000 });
      await expect(page.getByRole('link', { name: 'Overview' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Proxy Hosts' })).not.toBeVisible();
      await expect(page.getByRole('link', { name: 'Settings' })).not.toBeVisible();
    } finally {
      await page.close();
    }
  });

  test('viewer role: /profile loads successfully', async () => {
    const page = await viewerContext.newPage();
    try {
      await page.goto('/profile');
      await expect(page).not.toHaveURL(/\/login/, { timeout: 10_000 });
      await expect(page.getByText(/profile|password/i).first()).toBeVisible({ timeout: 5_000 });
    } finally {
      await page.close();
    }
  });

  // ── "user" role — blocked from admin-only pages ─────────────────────

  for (const path of ADMIN_ONLY_PAGES) {
    test(`user role: ${path} is blocked`, async () => {
      const page = await userContext.newPage();
      try {
        const response = await page.goto(path);
        // requireAdmin() throws "Administrator privileges required".
        // Next.js renders the error boundary or returns 500.
        const status = response?.status() ?? 0;
        const url = page.url();

        const isBlocked =
          status >= 400 ||
          url.includes('/login') ||
          await page.getByText(/administrator privileges|error|forbidden|not authorized/i)
            .isVisible({ timeout: 3_000 }).catch(() => false);

        expect(isBlocked).toBe(true);
      } finally {
        await page.close();
      }
    });
  }

  // ── "viewer" role — blocked from admin-only pages ───────────────────

  for (const path of ADMIN_ONLY_PAGES) {
    test(`viewer role: ${path} is blocked`, async () => {
      const page = await viewerContext.newPage();
      try {
        const response = await page.goto(path);
        const status = response?.status() ?? 0;
        const url = page.url();

        const isBlocked =
          status >= 400 ||
          url.includes('/login') ||
          await page.getByText(/administrator privileges|error|forbidden|not authorized/i)
            .isVisible({ timeout: 3_000 }).catch(() => false);

        expect(isBlocked).toBe(true);
      } finally {
        await page.close();
      }
    });
  }

  // ── Admin user — can access all pages ───────────────────────────────

  test('admin role: all dashboard pages are accessible', async ({ browser }) => {
    const adminContext = await loginAs(browser, 'testadmin', 'TestPassword2026!');
    try {
      for (const path of ALL_DASHBOARD_PAGES) {
        const page = await adminContext.newPage();
        const response = await page.goto(path);
        const status = response?.status() ?? 0;
        expect(status).toBeLessThan(400);
        expect(page.url()).not.toContain('/login');
        await page.close();
      }
    } finally {
      await adminContext.close();
    }
  });

  test('admin role: sidebar shows all nav items', async ({ browser }) => {
    const adminContext = await loginAs(browser, 'testadmin', 'TestPassword2026!');
    try {
      const page = await adminContext.newPage();
      await page.goto('/');
      await expect(page.getByRole('link', { name: 'Overview' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Proxy Hosts' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Users' })).toBeVisible();
      await page.close();
    } finally {
      await adminContext.close();
    }
  });

  // ── API endpoints — non-admin should be blocked ───────────────────────

  test('user role: API v1 endpoints return 401/403', async () => {
    const page = await userContext.newPage();
    try {
      const response = await page.request.get('/api/v1/proxy-hosts');
      expect(response.status()).toBeGreaterThanOrEqual(400);
    } finally {
      await page.close();
    }
  });

  test('viewer role: API v1 endpoints return 401/403', async () => {
    const page = await viewerContext.newPage();
    try {
      const response = await page.request.get('/api/v1/proxy-hosts');
      expect(response.status()).toBeGreaterThanOrEqual(400);
    } finally {
      await page.close();
    }
  });
});
