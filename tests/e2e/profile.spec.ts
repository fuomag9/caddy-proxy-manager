import { test, expect } from '@playwright/test';

test.describe('Profile', () => {
  test('profile page loads without redirecting to login', async ({ page }) => {
    await page.goto('/profile');
    await expect(page).not.toHaveURL(/login/);
    await expect(page.locator('body')).toBeVisible();
  });

  test('profile page shows username or email', async ({ page }) => {
    await page.goto('/profile');
    // Use first() since username appears in sidebar + profile body
    await expect(page.locator('text=/testadmin|testadmin@/i').first()).toBeVisible({ timeout: 5000 });
  });

  test('Change Password button is visible', async ({ page }) => {
    await page.goto('/profile');
    await expect(page.getByRole('button', { name: /change password|set password/i })).toBeVisible();
  });

  test('change password: wrong current password shows error', async ({ page }) => {
    await page.goto('/profile');

    await page.getByRole('button', { name: /change password|set password/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.getByLabel('Current Password').fill('WrongCurrentPassword!');
    await page.getByLabel('New Password').fill('NewPassword2026!');
    await page.getByLabel('Confirm New Password').fill('NewPassword2026!');

    await page.getByRole('button', { name: /change password|set password/i }).last().click();

    // Should show an error alert
    await expect(page.locator('[role="alert"]')).toBeVisible({ timeout: 10000 });
  });

  test('change password: new password too short shows validation error', async ({ page }) => {
    await page.goto('/profile');

    await page.getByRole('button', { name: /change password|set password/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.getByLabel('New Password').fill('short');
    await page.getByLabel('Confirm New Password').fill('short');

    await page.getByRole('button', { name: /change password|set password/i }).last().click();

    await expect(page.locator('text=/at least 12 characters/i')).toBeVisible({ timeout: 5000 });
  });
});
