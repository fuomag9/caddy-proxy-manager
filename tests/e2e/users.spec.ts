/**
 * E2E tests: Users management page.
 *
 * Verifies user listing, search, edit, disable/enable, delete, and create functionality.
 * Runs as admin (testadmin) — the page requires admin role.
 */
import { test, expect } from '@playwright/test';

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

  test('creating a user via the form adds it to the list', async ({ page }) => {
    await page.getByRole('button', { name: /create user/i }).click();

    await page.getByTestId('create-email').fill('newuser@test.local');
    await page.getByTestId('create-name').fill('New Test User');
    await page.getByTestId('create-password').fill('SecurePass2026!');

    await page.getByRole('button', { name: 'Create', exact: true }).click();

    await expect(page.getByTestId('create-email')).not.toBeVisible();
    await expect(page.getByText('newuser@test.local')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('New Test User')).toBeVisible({ timeout: 5000 });
  });

  test('creating a user with a specific role shows correct badge', async ({ page }) => {
    await page.getByRole('button', { name: /create user/i }).click();

    await page.getByTestId('create-email').fill('vieweruser@test.local');
    await page.getByTestId('create-name').fill('Viewer User');
    await page.getByTestId('create-password').fill('ViewerPass2026!');

    // Select Viewer role
    await page.getByTestId('create-role').click();
    await page.getByRole('option', { name: 'Viewer' }).click();

    await page.getByRole('button', { name: 'Create', exact: true }).click();

    await expect(page.getByText('vieweruser@test.local')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('viewer', { exact: true }).first()).toBeVisible({ timeout: 5000 });
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

  test('admin can create a user via API', async ({ page }) => {
    const origin = new URL(page.url()).origin;

    const response = await page.request.post('http://localhost:3000/api/v1/users', {
      headers: { Origin: origin },
      data: {
        email: 'api-created@test.local',
        name: 'API Created',
        password: 'ApiPass2026!',
        role: 'user',
      },
    });

    expect(response.status()).toBe(201);
    const body = await response.json();
    expect(body.email).toBe('api-created@test.local');
    expect(body.name).toBe('API Created');
    expect(body.role).toBe('user');
    expect(body.passwordHash).toBeUndefined();

    await page.goto('/users');
    await expect(page.getByText('api-created@test.local')).toBeVisible({ timeout: 5000 });
  });

  test('admin can create a viewer via API', async ({ page }) => {
    const origin = new URL(page.url()).origin;

    const response = await page.request.post('http://localhost:3000/api/v1/users', {
      headers: { Origin: origin },
      data: {
        email: 'api-viewer@test.local',
        name: 'API Viewer',
        password: 'ViewerPass2026!',
        role: 'viewer',
      },
    });

    expect(response.status()).toBe(201);
    const body = await response.json();
    expect(body.role).toBe('viewer');
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
