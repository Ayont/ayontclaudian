import { pathToFileURL } from 'node:url';
import path from 'node:path';

import { expect, test } from '@playwright/test';

const HARNESS_URL = pathToFileURL(path.join(__dirname, 'components.html')).href;

const SECTIONS = ['goal-banner', 'permission-toggle', 'statusbar', 'switch-model'] as const;

test.beforeEach(async ({ page }) => {
  await page.goto(HARNESS_URL);
  // Let fonts/layout settle for stable screenshots.
  await page.waitForLoadState('networkidle');
});

for (const section of SECTIONS) {
  test(`component ${section} matches snapshot`, async ({ page }, testInfo) => {
    const el = page.locator(`[data-vis="${section}"]`);
    await expect(el).toBeVisible();
    await expect(el).toHaveScreenshot(`${section}-${testInfo.project.name}.png`, {
      maxDiffPixelRatio: 0.01,
    });
  });
}
