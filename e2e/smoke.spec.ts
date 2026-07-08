import { test, expect } from '@playwright/test';

test('app loads with cross-origin isolation (required for OPFS/sqlocal)', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('engine-version')).toContainText('engine v');
  const isolated = await page.evaluate(() => crossOriginIsolated);
  expect(isolated).toBe(true);
});
