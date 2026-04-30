/**
 * E2E tests: Users management page.
 *
 * Verifies user listing, search, edit, disable/enable, delete, and create functionality.
 * Runs as admin (testadmin) — the page requires admin role.
 */
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';

const BASE = 'http://localhost:3000';
const COMPOSE_ARGS = [
  'compose',
  '-f', 'docker-compose.yml',
  '-f', 'tests/docker-compose.test.yml',
];

type CreatedUserRecord = {
  email: string;
  provider: string | null;
  subject: string | null;
  username: string | null;
  displayUsername: string | null;
  accountProviderId: string | null;
  accountId: string | null;
  accountHasPassword: boolean;
  role: string;
};

function execInContainer(script: string): string {
  return execFileSync('docker', [...COMPOSE_ARGS, 'exec', '-T', 'web', 'bun', '-e', script], {
    cwd: process.cwd(),
    stdio: 'pipe',
    encoding: 'utf8',
  });
}

function getCreatedUserRecord(email: string): CreatedUserRecord {
  const output = execInContainer(`
    import { Database } from "bun:sqlite";
    const db = new Database("./data/caddy-proxy-manager.db");
    const user = db.query(
      "SELECT id, email, provider, subject, username, displayUsername, role FROM users WHERE email = ?"
    ).get(${JSON.stringify(email)});
    if (!user) {
      console.error("User not found");
      process.exit(1);
    }
    const account = db.query(
      "SELECT providerId, accountId, password FROM accounts WHERE userId = ? AND providerId = 'credential'"
    ).get(user.id);
    console.log(JSON.stringify({
      email: user.email,
      provider: user.provider,
      subject: user.subject,
      username: user.username,
      displayUsername: user.displayUsername,
      accountProviderId: account?.providerId ?? null,
      accountId: account?.accountId ?? null,
      accountHasPassword: !!account?.password,
      role: user.role,
    }));
  `).trim();

  return JSON.parse(output) as CreatedUserRecord;
}

async function loginWithCredentials(
  browser: import('@playwright/test').Browser,
  username: string,
  password: string,
) {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();

  await page.goto(`${BASE}/login`);
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 10000 });

  return { context, page };
}

test.describe('Users page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/users');
  });

  test('page loads with Users heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible();
    await expect(page.getByText('Manage user accounts, roles, and access.')).toBeVisible();
  });

  test('displays at least one user (the admin)', async ({ page }) => {
    await expect(page.getByText(/\d+ users?/)).toBeVisible({ timeout: 5000 });
  });

  test('search input filters users', async ({ page }) => {
    await page.getByPlaceholder('Search users...').fill('testadmin');
    await expect(page.getByText(/1 user/)).toBeVisible({ timeout: 5000 });

    await page.getByPlaceholder('Search users...').fill('nonexistent-zzz');
    await expect(page.getByText('No users found.')).toBeVisible({ timeout: 5000 });
  });

  test('admin user shows admin role badge', async ({ page }) => {
    await expect(page.getByText('admin', { exact: true }).first()).toBeVisible();
  });

  test('clicking edit button shows edit form', async ({ page }) => {
    await page.getByTitle('Edit user').first().click();
    await expect(page.getByText(/editing/i)).toBeVisible();
    await expect(page.getByPlaceholder('Display name')).toBeVisible();
    await expect(page.getByPlaceholder('Email address')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
  });

  test('clicking cancel closes the edit form', async ({ page }) => {
    await page.getByTitle('Edit user').first().click();
    await expect(page.getByText(/editing/i)).toBeVisible();

    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByText(/editing/i)).not.toBeVisible();
  });

  test('edit form has role select with Admin, User, Viewer options', async ({ page }) => {
    await page.getByTitle('Edit user').first().click();

    // The role select trigger should be visible
    const roleTrigger = page.getByRole('combobox').first();
    await expect(roleTrigger).toBeVisible();
    await roleTrigger.click();

    // Check dropdown options
    await expect(page.getByRole('option', { name: 'Admin' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'User' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'Viewer' })).toBeVisible();
  });

  test('user row shows action buttons (edit, disable, delete)', async ({ page }) => {
    await expect(page.getByTitle('Edit user').first()).toBeVisible();
    await expect(page.getByTitle('Disable user').first()).toBeVisible();
    await expect(page.getByTitle('Delete user').first()).toBeVisible();
  });

  // ── Create user (UI) ──────────────────────────────────────────────────

  test('Create User button is visible', async ({ page }) => {
    await expect(page.getByRole('button', { name: /create user/i })).toBeVisible();
  });

  test('clicking Create User shows create form', async ({ page }) => {
    await page.getByRole('button', { name: /create user/i }).click();

    await expect(page.getByTestId('create-email')).toBeVisible();
    await expect(page.getByTestId('create-name')).toBeVisible();
    await expect(page.getByTestId('create-role')).toBeVisible();
    await expect(page.getByTestId('create-password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
  });

  test('clicking Cancel hides the create form', async ({ page }) => {
    await page.getByRole('button', { name: /create user/i }).click();
    await expect(page.getByTestId('create-email')).toBeVisible();

    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByTestId('create-email')).not.toBeVisible();
  });

  test('creating a user via the form provisions a working credential account', async ({ page, browser }) => {
    const email = `newuser-ui-${Date.now()}@test.local`;
    const password = 'SecurePass2026!';
    const expectedUsername = email;

    await page.getByRole('button', { name: /create user/i }).click();

    await page.getByTestId('create-email').fill(email);
    await page.getByTestId('create-name').fill('New Test User');
    await page.getByTestId('create-password').fill(password);

    await page.getByRole('button', { name: 'Create', exact: true }).click();

    await expect(page.getByTestId('create-email')).not.toBeVisible();
    await expect(page.getByText(email)).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('New Test User')).toBeVisible({ timeout: 5000 });

    const created = getCreatedUserRecord(email);
    expect(created.provider).toBe('credentials');
    expect(created.subject).toBe(expectedUsername);
    expect(created.username).toBe(expectedUsername);
    expect(created.displayUsername).toBe('New Test User');
    expect(created.accountProviderId).toBe('credential');
    expect(created.accountId).not.toBeNull();
    expect(created.accountHasPassword).toBe(true);

    const { context, page: loginPage } = await loginWithCredentials(browser, expectedUsername, password);
    await expect(loginPage).not.toHaveURL(/\/login/, { timeout: 10000 });
    await context.close();
  });

  test('creating a user with a specific role shows correct badge and email login works', async ({ page, browser }) => {
    const email = `viewer-ui-${Date.now()}@test.local`;
    const password = 'ViewerPass2026!';
    const expectedUsername = email;

    await page.getByRole('button', { name: /create user/i }).click();

    await page.getByTestId('create-email').fill(email);
    await page.getByTestId('create-name').fill('Viewer User');
    await page.getByTestId('create-password').fill(password);

    // Select Viewer role
    await page.getByTestId('create-role').click();
    await page.getByRole('option', { name: 'Viewer' }).click();

    await page.getByRole('button', { name: 'Create', exact: true }).click();

    await expect(page.getByText(email)).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('viewer', { exact: true }).first()).toBeVisible({ timeout: 5000 });

    const created = getCreatedUserRecord(email);
    expect(created.role).toBe('viewer');
    expect(created.provider).toBe('credentials');
    expect(created.subject).toBe(expectedUsername);
    expect(created.username).toBe(expectedUsername);

    const { context } = await loginWithCredentials(browser, expectedUsername, password);
    await context.close();
  });
});

test.describe('Users page — unauthenticated access', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('unauthenticated access to /users redirects to /login', async ({ page }) => {
    await page.goto('/users');
    await expect(page).toHaveURL(/\/login/);
  });
});

// ── API v1 create user tests ─────────────────────────────────────────────

test.describe('Users API v1 — create user (POST)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page).not.toHaveURL(/\/login/);
  });

  test('admin can create a user via API', async ({ page, browser }) => {
    const origin = new URL(page.url()).origin;
    const email = `api-created-${Date.now()}@test.local`;
    const password = 'ApiPass2026!';
    const expectedUsername = email;

    const response = await page.request.post('http://localhost:3000/api/v1/users', {
      headers: { Origin: origin },
      data: {
        email,
        name: 'API Created',
        password,
        role: 'user',
      },
    });

    expect(response.status()).toBe(201);
    const body = await response.json();
    expect(body.email).toBe(email);
    expect(body.name).toBe('API Created');
    expect(body.role).toBe('user');
    expect(body.passwordHash).toBeUndefined();

    const created = getCreatedUserRecord(email);
    expect(created.provider).toBe('credentials');
    expect(created.subject).toBe(expectedUsername);
    expect(created.username).toBe(expectedUsername);
    expect(created.accountProviderId).toBe('credential');
    expect(created.accountHasPassword).toBe(true);

    await page.goto('/users');
    await expect(page.getByText(email)).toBeVisible({ timeout: 5000 });

    const { context } = await loginWithCredentials(browser, expectedUsername, password);
    await context.close();
  });

  test('admin can create a viewer via API', async ({ page }) => {
    const origin = new URL(page.url()).origin;
    const email = `api-viewer-${Date.now()}@test.local`;

    const response = await page.request.post('http://localhost:3000/api/v1/users', {
      headers: { Origin: origin },
      data: {
        email,
        name: 'API Viewer',
        password: 'ViewerPass2026!',
        role: 'viewer',
      },
    });

    expect(response.status()).toBe(201);
    const body = await response.json();
    expect(body.role).toBe('viewer');

    const created = getCreatedUserRecord(email);
    expect(created.role).toBe('viewer');
    expect(created.provider).toBe('credentials');
    expect(created.accountProviderId).toBe('credential');
  });

  test('API POST with invalid role is downgraded to user', async ({ page }) => {
    const origin = new URL(page.url()).origin;
    const email = `api-invalid-role-${Date.now()}@test.local`;

    const response = await page.request.post('http://localhost:3000/api/v1/users', {
      headers: { Origin: origin },
      data: {
        email,
        name: 'Invalid Role',
        password: 'InvalidRole2026!',
        role: 'superadmin',
      },
    });

    expect(response.status()).toBe(201);
    const body = await response.json();
    expect(body.role).toBe('user');

    const created = getCreatedUserRecord(email);
    expect(created.role).toBe('user');
  });

  test('API POST returns 400 when email is missing', async ({ page }) => {
    const origin = new URL(page.url()).origin;

    const response = await page.request.post('http://localhost:3000/api/v1/users', {
      headers: { Origin: origin },
      data: {
        name: 'No Email',
        password: 'SomePass2026!',
      },
    });

    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('required');
  });

  test('API POST returns 400 when password is missing', async ({ page }) => {
    const origin = new URL(page.url()).origin;

    const response = await page.request.post('http://localhost:3000/api/v1/users', {
      headers: { Origin: origin },
      data: {
        email: 'nopass@test.local',
        name: 'No Password',
      },
    });

    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('required');
  });
});

test.describe('Users API v1 — create user (POST) — non-admin blocked', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('unauthenticated POST is blocked', async ({ request }) => {
    const response = await request.post('http://localhost:3000/api/v1/users', {
      data: {
        email: 'unauthed@test.local',
        name: 'Unauthed',
        password: 'Pass2026!',
      },
    });

    expect(response.status()).toBeGreaterThanOrEqual(400);
  });
});
