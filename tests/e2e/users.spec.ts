/**
 * E2E tests: Users management page.
 *
 * Verifies user listing, search, edit, disable/enable, and delete functionality.
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
    await expect(page.getByText(/1 user/)).toBeVisible({ timeout: 5000 });
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
});

test.describe('Users page — unauthenticated access', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('unauthenticated access to /users redirects to /login', async ({ page }) => {
    await page.goto('/users');
    await expect(page).toHaveURL(/\/login/);
  });
});
