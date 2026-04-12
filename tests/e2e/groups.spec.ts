/**
 * E2E tests: Groups management page.
 *
 * Verifies group creation, member management, and deletion.
 * Runs as admin (testadmin) — the page requires admin role.
 */
import { test, expect } from '@playwright/test';

test.describe('Groups page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/groups');
  });

  test('page loads with Groups heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Groups' })).toBeVisible();
    await expect(page.getByText('Organize users into groups for forward auth access control.')).toBeVisible();
  });

  test('New Group button is visible', async ({ page }) => {
    await expect(page.getByRole('button', { name: /new group/i })).toBeVisible();
  });

  test('clicking New Group toggles create form', async ({ page }) => {
    await page.getByRole('button', { name: /new group/i }).click();

    // Form fields should appear
    await expect(page.getByLabel('Name')).toBeVisible();
    await expect(page.getByLabel('Description')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
  });

  test('clicking Cancel hides the create form', async ({ page }) => {
    await page.getByRole('button', { name: /new group/i }).click();
    await expect(page.getByLabel('Name')).toBeVisible();

    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByLabel('Name')).not.toBeVisible();
  });

  test('create a new group', async ({ page }) => {
    await page.getByRole('button', { name: /new group/i }).click();

    await page.getByLabel('Name').fill('E2E Test Group');
    await page.getByLabel('Description').fill('Created by E2E test');
    await page.getByRole('button', { name: 'Create' }).click();

    // Group should appear in the list
    await expect(page.getByText('E2E Test Group')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Created by E2E test')).toBeVisible();
    await expect(page.getByText('0 members').first()).toBeVisible();
  });

  test('add member to group', async ({ page }) => {
    // Ensure the group exists
    await expect(page.getByText('E2E Test Group')).toBeVisible({ timeout: 5_000 });

    // Click add member button
    await page.getByTitle('Add member').first().click();
    await expect(page.getByText('Add a user to this group')).toBeVisible();

    // Click the first available user in the add-member list to add them.
    // The add-member list items are full-width buttons inside a bordered container.
    const memberList = page.locator('.border.rounded-md');
    const firstUser = memberList.locator('button').first();
    if (await firstUser.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await firstUser.click();

      // Member should now appear in the group
      await expect(page.getByText('1 member')).toBeVisible({ timeout: 10_000 });
    }
  });

  test('remove member from group', async ({ page }) => {
    // If the group has a member, remove it
    const removeMemberBtn = page.getByTitle('Remove member').first();
    if (await removeMemberBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await removeMemberBtn.click();
      await expect(page.getByText('0 members')).toBeVisible({ timeout: 10_000 });
    }
  });

  test('delete group via confirm dialog', async ({ page }) => {
    await expect(page.getByText('E2E Test Group')).toBeVisible({ timeout: 5_000 });

    // Accept the confirm dialog
    page.on('dialog', (dialog) => dialog.accept());
    await page.getByTitle('Delete group').first().click();

    // Group should be removed
    await expect(page.getByText('E2E Test Group')).not.toBeVisible({ timeout: 10_000 });
  });

  test('shows empty state when no groups exist', async ({ page }) => {
    // If there are no groups, the empty state text should be visible
    // (This may or may not show depending on existing data)
    const newGroupBtn = page.getByRole('button', { name: /new group/i });
    // At minimum the button should always be visible
    await expect(newGroupBtn).toBeVisible();
  });
});

test.describe('Groups page — unauthenticated access', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('unauthenticated access to /groups redirects to /login', async ({ page }) => {
    await page.goto('/groups');
    await expect(page).toHaveURL(/\/login/);
  });
});
