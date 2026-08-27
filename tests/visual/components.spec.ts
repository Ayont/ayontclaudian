import { pathToFileURL } from 'node:url';
import path from 'node:path';

import { expect, test } from '@playwright/test';

const HARNESS_URL = pathToFileURL(path.join(__dirname, 'components.html')).href;

const SECTIONS = [
  'goal-banner',
  'permission-toggle',
  'statusbar',
  'switch-model',
  'mission-card',
  'synthesis',
  'activity-feed',
  'provider-capabilities',
  'feature-map',
  'workflow-live',
  'live-document',
  'document-library-mobile',
  'artifact-gallery',
  'usage-sparkline',
] as const;

test.beforeEach(async ({ page }) => {
  await page.goto(HARNESS_URL);
  // Let fonts/layout settle for stable screenshots.
  await page.waitForLoadState('networkidle');
});

test('320px project exposes a coarse touch pointer', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'w320');
  await expect.poll(() => page.evaluate(() => ({
    coarse: matchMedia('(pointer: coarse)').matches,
    touchPoints: navigator.maxTouchPoints,
  }))).toEqual({ coarse: true, touchPoints: 1 });
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
