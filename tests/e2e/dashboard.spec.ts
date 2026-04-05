/**
 * E2E tests: Dashboard (overview) home page.
 *
 * Verifies stat cards, navigation links, welcome header, and recent activity.
 */
import { test, expect } from '@playwright/test';

test.describe('Dashboard home page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('displays welcome header with user name', async ({ page }) => {
    await expect(page.getByText(/welcome back/i)).toBeVisible();
  });

  test('shows stat cards for Proxy Hosts, Certificates, and Access Lists', async ({ page }) => {
    await expect(page.getByText('Proxy Hosts')).toBeVisible();
    await expect(page.getByText('Certificates')).toBeVisible();
    await expect(page.getByText('Access Lists')).toBeVisible();
  });

  test('shows Traffic (24h) card', async ({ page }) => {
    await expect(page.getByText('Traffic (24h)')).toBeVisible();
  });

  test('stat card links navigate to correct pages', async ({ page }) => {
    await page.getByRole('link', { name: /proxy hosts/i }).first().click();
    await expect(page).toHaveURL(/\/proxy-hosts/);
  });

  test('Certificates stat card navigates to /certificates', async ({ page }) => {
    await page.getByRole('link', { name: /certificates/i }).first().click();
    await expect(page).toHaveURL(/\/certificates/);
  });

  test('Access Lists stat card navigates to /access-lists', async ({ page }) => {
    await page.getByRole('link', { name: /access lists/i }).first().click();
    await expect(page).toHaveURL(/\/access-lists/);
  });

  test('Traffic card navigates to /analytics', async ({ page }) => {
    await page.getByRole('link', { name: /traffic/i }).first().click();
    await expect(page).toHaveURL(/\/analytics/);
  });

  test('shows Recent Activity section', async ({ page }) => {
    await expect(page.getByText(/recent activity/i)).toBeVisible();
  });
});
