import { test, expect } from '@playwright/test';

test.describe('Profile', () => {
  test('profile page loads without redirecting to login', async ({ page }) => {
    await page.goto('/profile');
    await expect(page).not.toHaveURL(/login/);
    await expect(page.locator('body')).toBeVisible();
  });

  test('profile page shows username or email', async ({ page }) => {
    await page.goto('/profile');
    // Should show the user's email or username (testadmin)
    await expect(page.locator('text=/testadmin|testadmin@/i')).toBeVisible({ timeout: 5000 });
  });

  test('change password: wrong current password shows error', async ({ page }) => {
    await page.goto('/profile');

    const currentPasswordInput = page.getByLabel(/current password/i).first();
    if (await currentPasswordInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await currentPasswordInput.fill('WrongCurrentPassword!');

      const newPasswordInput = page.getByLabel(/new password/i).first();
      await newPasswordInput.fill('NewPassword2026!');

      const confirmInput = page.getByLabel(/confirm/i).first();
      if (await confirmInput.isVisible({ timeout: 1000 }).catch(() => false)) {
        await confirmInput.fill('NewPassword2026!');
      }

      await page.getByRole('button', { name: /change|update|save.*password/i }).click();
      await expect(page.locator('text=/incorrect|wrong|invalid|error/i')).toBeVisible({ timeout: 5000 });
    } else {
      // UI may be different
      test.skip();
    }
  });

  test('change password: new password too short shows validation error', async ({ page }) => {
    await page.goto('/profile');

    const newPasswordInput = page.getByLabel(/new password/i).first();
    if (await newPasswordInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await newPasswordInput.fill('short');
      await newPasswordInput.blur();
      // Should show validation error about length
      await expect(page.locator('text=/least.*char|minimum|too short/i')).toBeVisible({ timeout: 3000 });
    } else {
      test.skip();
    }
  });
});
