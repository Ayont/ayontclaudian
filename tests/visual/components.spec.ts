import { pathToFileURL } from 'node:url';
import path from 'node:path';

import { expect, test } from '@playwright/test';

const HARNESS_URL = pathToFileURL(path.join(__dirname, 'components.html')).href;

const LEGACY_SECTIONS = [
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

const CONTROL_SECTIONS = ['fast-chip', 'model-picker', 'composer-toolbar'] as const;

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

test('model picker keeps selection content inside non-overlapping rows', async ({ page }) => {
  const picker = page.locator('[data-vis="model-picker"] .claudian-model-select-modal');
  const list = picker.locator('.claudian-model-select-list');
  await expect(picker).toBeVisible();
  await expect(picker.locator('button.claudian-model-select-option[aria-pressed="true"]')).toHaveCount(1);

  const overflow = await picker.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);

  const selected = list.locator('.claudian-model-select-option.is-selected');
  const description = selected.locator('.claudian-model-select-option-description');
  const check = selected.locator('.claudian-model-select-option-check');
  const followingRow = list.locator('.claudian-model-select-option.is-selected + .claudian-model-select-option');
  const [rowBox, descriptionBox, checkBox, followingBox] = await Promise.all([
    selected.boundingBox(),
    description.boundingBox(),
    check.boundingBox(),
    followingRow.boundingBox(),
  ]);
  if (!rowBox || !descriptionBox || !checkBox || !followingBox) {
    throw new Error('Model picker regression fixture is missing a measurable row element.');
  }

  const tolerance = 0.5;
  expect(descriptionBox.x).toBeGreaterThanOrEqual(rowBox.x - tolerance);
  expect(descriptionBox.x + descriptionBox.width).toBeLessThanOrEqual(rowBox.x + rowBox.width + tolerance);
  expect(descriptionBox.y).toBeGreaterThanOrEqual(rowBox.y - tolerance);
  expect(descriptionBox.y + descriptionBox.height).toBeLessThanOrEqual(rowBox.y + rowBox.height + tolerance);
  expect(checkBox.x).toBeGreaterThanOrEqual(rowBox.x - tolerance);
  expect(checkBox.x + checkBox.width).toBeLessThanOrEqual(rowBox.x + rowBox.width + tolerance);
  expect(checkBox.y).toBeGreaterThanOrEqual(rowBox.y - tolerance);
  expect(checkBox.y + checkBox.height).toBeLessThanOrEqual(rowBox.y + rowBox.height + tolerance);
  expect(rowBox.y + rowBox.height).toBeLessThanOrEqual(followingBox.y + tolerance);
});

test('composer toolbar contains its controls and keeps send visible', async ({ page }) => {
  const toolbar = page.locator('[data-vis="composer-toolbar"] .claudian-input-toolbar');
  const send = toolbar.locator('.claudian-send-btn');
  await expect(toolbar).toBeVisible();
  await expect(send).toBeVisible();

  const overflow = await toolbar.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
});

test('model picker variants keep coarse-pointer touch targets', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'w320');
  const effort = page.locator('[data-vis="model-picker"] .claudian-model-select-effort').first();
  await expect(effort).toBeVisible();
  const box = await effort.boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(44);
});

test('composer adapts to a narrow Obsidian pane independently of viewport width', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'w1440');
  const wrapper = page.locator('[data-vis="composer-toolbar"] .claudian-input-wrapper');
  await wrapper.evaluate((element) => {
    element.style.width = '320px';
  });
  const toolbar = wrapper.locator('.claudian-input-toolbar');
  const controls = toolbar.locator('.claudian-toolbar-control-group');
  const modes = toolbar.locator('.claudian-toolbar-mode-group');
  const send = toolbar.locator('.claudian-send-btn');
  const [toolbarBox, controlsBox, modesBox, sendBox] = await Promise.all([
    toolbar.boundingBox(),
    controls.boundingBox(),
    modes.boundingBox(),
    send.boundingBox(),
  ]);
  if (!toolbarBox || !controlsBox || !modesBox || !sendBox) {
    throw new Error('Narrow composer regression fixture is missing a measurable control group.');
  }

  const overflow = await toolbar.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
  expect(modesBox.y).toBeGreaterThanOrEqual(controlsBox.y + controlsBox.height - 0.5);
  expect(sendBox.x + sendBox.width).toBeLessThanOrEqual(toolbarBox.x + toolbarBox.width + 0.5);
});

for (const section of LEGACY_SECTIONS) {
  test(`component ${section} matches snapshot`, async ({ page }, testInfo) => {
    // Keep the established fixture order stable so existing snapshots are not
    // shifted by the taller control-regression fixtures added above them.
    await page.locator(CONTROL_SECTIONS.map((name) => `[data-vis="${name}"]`).join(',')).evaluateAll((elements) => {
      elements.forEach((element) => element.remove());
    });
    const el = page.locator(`[data-vis="${section}"]`);
    await expect(el).toBeVisible();
    await expect(el).toHaveScreenshot(`${section}-${testInfo.project.name}.png`, {
      maxDiffPixelRatio: 0.01,
    });
  });
}

for (const section of CONTROL_SECTIONS) {
  test(`component ${section} matches snapshot`, async ({ page }, testInfo) => {
    // Isolate the new, deliberately tall regression fixtures. This keeps
    // mobile Chromium element captures below compositor scroll limits and
    // prevents unrelated hover states from entering the baselines.
    await page.evaluate((visibleSection) => {
      document.querySelectorAll<HTMLElement>('.harness-section').forEach((candidate) => {
        if (candidate.dataset.vis !== visibleSection) candidate.remove();
      });
    }, section);
    const el = page.locator(`[data-vis="${section}"]`);
    await expect(el).toBeVisible();
    if (section === 'model-picker') {
      const interactionRow = el.locator('[data-preview-interaction="true"]');
      await interactionRow.focus();
      await interactionRow.hover();
    } else {
      await page.mouse.move(1, 1);
    }
    await expect(el).toHaveScreenshot(`${section}-${testInfo.project.name}.png`, {
      maxDiffPixelRatio: 0.01,
    });
  });
}
