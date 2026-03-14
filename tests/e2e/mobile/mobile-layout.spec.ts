import { test, expect } from '@playwright/test';

// Force a mobile viewport even under the desktop Chromium project so these
// checks validate responsive behavior instead of self-skipping.
test.use({ viewport: { width: 393, height: 852 } });

test.describe('Mobile layout', () => {
  test('app bar is visible with hamburger and title', async ({ page }) => {
    await page.goto('/');
    // The MUI AppBar should be present on mobile
    const appBar = page.locator('header');
    await expect(appBar).toBeVisible();
    // Hamburger button
    await expect(page.getByRole('button', { name: /open drawer/i })).toBeVisible();
    // Title text
    await expect(page.getByText('Caddy Proxy Manager')).toBeVisible();
  });

  test('drawer opens and closes via hamburger', async ({ page }) => {
    await page.goto('/');
    // Drawer is closed initially — it renders as a dialog with keepMounted
    // but the dialog should not be visible (no active attr on closed drawer)
    // Open drawer first to get a reference to the dialog
    const drawerDialog = page.locator('[role="dialog"]');
    // The dialog is hidden (not visible) before opening
    await expect(drawerDialog.getByRole('link', { name: /proxy hosts/i })).not.toBeVisible();
    // Open drawer
    await page.getByRole('button', { name: /open drawer/i }).click();
    await expect(drawerDialog.getByRole('link', { name: /proxy hosts/i })).toBeVisible();
    // Close by pressing Escape
    await page.keyboard.press('Escape');
    await expect(drawerDialog.getByRole('link', { name: /proxy hosts/i })).not.toBeVisible();
  });

  test('navigating from drawer closes it', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /open drawer/i }).click();
    const drawerDialog = page.locator('[role="dialog"]');
    const drawerNavLink = drawerDialog.getByRole('link', { name: /proxy hosts/i });
    await expect(drawerNavLink).toBeVisible();
    // Click a nav link inside the drawer
    await drawerNavLink.click();
    await expect(page).toHaveURL('/proxy-hosts');
    // Drawer should close after navigation — drawer links no longer visible
    await expect(drawerDialog.getByRole('link', { name: /access lists/i })).not.toBeVisible();
  });

  test('proxy hosts page shows card list, not a table', async ({ page }) => {
    await page.goto('/proxy-hosts');
    // On mobile with mobileCard, there should be no <table> element
    // (DataTable renders cards instead)
    await expect(page.locator('table')).not.toBeVisible();
  });

  test('page header action button appears below title on mobile', async ({ page }) => {
    await page.goto('/proxy-hosts');
    const title = page.getByRole('heading', { name: /proxy hosts/i });
    const button = page.getByRole('button', { name: /create host/i });
    await expect(title).toBeVisible();
    await expect(button).toBeVisible();
    // Button should be below the title — its Y coordinate should be greater
    const titleBox = await title.boundingBox();
    const buttonBox = await button.boundingBox();
    expect(titleBox).not.toBeNull();
    expect(buttonBox).not.toBeNull();
    expect(buttonBox!.y).toBeGreaterThan(titleBox!.y + titleBox!.height - 1);
  });

  test('create host dialog is usable at mobile width', async ({ page }) => {
    await page.goto('/proxy-hosts');
    await page.getByRole('button', { name: /create host/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // Dialog should not overflow — check it fits in viewport
    const dialogBox = await dialog.boundingBox();
    const viewportWidth = page.viewportSize()?.width ?? 393;
    expect(dialogBox).not.toBeNull();
    expect(dialogBox!.width).toBeLessThanOrEqual(viewportWidth + 1); // +1 for rounding
    // Key form fields should be visible
    await expect(page.getByLabel(/domains/i)).toBeVisible();
  });

  test('card edit and delete actions reachable without scrolling', async ({ page }) => {
    await page.goto('/proxy-hosts');
    // Create a host so there is at least one card to inspect
    await page.getByRole('button', { name: /create host/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByLabel('Name').fill('Mobile Test Host');
    await page.getByLabel(/domains/i).fill('mobile-test.local');
    await page.getByPlaceholder('10.0.0.5:8080').fill('localhost:9999');
    await page.getByRole('button', { name: /^create$/i }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10_000 });
    // The mobileCard renderer must include Edit and Delete icon buttons with aria-labels.
    // They should be immediately visible — no horizontal scroll needed.
    await expect(page.getByRole('button', { name: /^edit$/i }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /^delete$/i }).first()).toBeVisible();
  });

  test('analytics page loads without horizontal body overflow', async ({ page }) => {
    await page.goto('/analytics');
    // Wait for content to load
    await page.waitForLoadState('networkidle');
    // The document body should not be wider than the viewport
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = page.viewportSize()?.width ?? 393;
    expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 5); // 5px tolerance
  });
});
