/**
 * E2E tests: API Docs page (OpenAPI / Swagger UI).
 *
 * Verifies the page loads and Swagger UI renders the OpenAPI spec.
 * The page requires admin role.
 */
import { test, expect } from '@playwright/test';

test.describe('API Docs page', () => {
  test('page loads without error', async ({ page }) => {
    await page.goto('/api-docs');
    await expect(page).not.toHaveURL(/login/);
  });

  test('Swagger UI renders with API information', async ({ page }) => {
    await page.goto('/api-docs');

    // Swagger UI loads the spec and renders info — wait for the info container
    await expect(page.locator('.swagger-ui')).toBeVisible({ timeout: 30_000 });
  });

  test('OpenAPI spec endpoint returns valid JSON', async ({ request }) => {
    const response = await request.get('/api/v1/openapi.json');
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty('openapi');
    expect(body).toHaveProperty('paths');
  });
});

test.describe('API Docs page — unauthenticated access', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('unauthenticated access to /api-docs redirects to /login', async ({ page }) => {
    await page.goto('/api-docs');
    await expect(page).toHaveURL(/\/login/);
  });
});
