import { pathToFileURL } from 'node:url';
import path from 'node:path';

import { expect, type Page, test } from '@playwright/test';

/**
 * Visual regression for the library drawer (search, thumbnails, highlights) and
 * the chat navigation (docked arrow rail, "Zum Ende" pill). Renders the static
 * harness tests/visual/library.html against the BUILT styles.css — run
 * `npm run build:css` first.
 */

const HARNESS_URL = pathToFileURL(path.join(__dirname, 'library.html')).href;

const SECTIONS = [
  'library-arrows',
  'library-search',
  'library-thumbnails',
  'library-no-results',
  'chat-end-pill',
] as const;

const LIGHT_SECTIONS = ['library-arrows', 'chat-end-pill'] as const;

const TOLERANCE = 0.5;

async function isolate(page: Page, section: string): Promise<void> {
  await page.evaluate((visible) => {
    document.querySelectorAll<HTMLElement>('.harness-section').forEach((candidate) => {
      if (candidate.dataset.vis !== visible) candidate.remove();
    });
  }, section);
}

test.beforeEach(async ({ page }) => {
  await page.goto(HARNESS_URL);
  await page.waitForLoadState('networkidle');
  await page.mouse.move(1, 1);
});

test('the arrow rail never overlaps the open library', async ({ page }, testInfo) => {
  const section = page.locator('[data-vis="library-arrows"]');
  const rail = section.locator('.claudian-nav-sidebar');
  const panel = section.locator('.claudian-preview-panel');
  const visibility = await rail.evaluate((element) => getComputedStyle(element).visibility);

  if (testInfo.project.name === 'w1440') {
    // Wide window, 420px sidebar: the rail docks to the drawer's outer edge.
    expect(visibility).toBe('visible');
    const [railBox, panelBox] = await Promise.all([rail.boundingBox(), panel.boundingBox()]);
    if (!railBox || !panelBox) throw new Error('Rail or drawer is not measurable.');
    expect(railBox.x + railBox.width).toBeLessThanOrEqual(panelBox.x - 4 + TOLERANCE);
    expect(railBox.x).toBeGreaterThanOrEqual(0);
    await expect(rail.locator('.claudian-nav-btn-bottom')).toBeVisible();
  } else {
    // Fullscreen drawer: nothing of the transcript is visible, so no rail.
    expect(visibility).toBe('hidden');
  }

  // The pill would sit under the drawer, so it stays hidden while the library is open.
  const pillVisibility = await section.locator('.claudian-nav-end-pill')
    .evaluate((element) => getComputedStyle(element).visibility);
  expect(pillVisibility).toBe('hidden');

  for (const button of await rail.locator('.claudian-nav-btn').all()) {
    await expect(button).toHaveAttribute('data-tooltip-position', 'left');
    await expect(button).not.toHaveAttribute('title', /.*/);
  }
});

test('the "Zum Ende" pill is centered over the transcript and sits above the composer', async ({ page }, testInfo) => {
  const section = page.locator('[data-vis="chat-end-pill"]');
  const wrapper = section.locator('.claudian-messages-wrapper');
  const pill = section.locator('.claudian-nav-end-pill');
  await expect(pill).toBeVisible();
  const [pillBox, wrapperBox] = await Promise.all([pill.boundingBox(), wrapper.boundingBox()]);
  if (!pillBox || !wrapperBox) throw new Error('Pill or wrapper is not measurable.');

  const pillCenter = pillBox.x + pillBox.width / 2;
  const wrapperCenter = wrapperBox.x + wrapperBox.width / 2;
  expect(Math.abs(pillCenter - wrapperCenter)).toBeLessThanOrEqual(1);
  expect(pillBox.y + pillBox.height).toBeLessThanOrEqual(wrapperBox.y + wrapperBox.height + TOLERANCE);
  expect(pillBox.x).toBeGreaterThanOrEqual(wrapperBox.x);
  await expect(pill.locator('.claudian-nav-end-pill-label')).toHaveText('Neue Ausgabe');
  if (testInfo.project.name === 'w320') expect(pillBox.height).toBeGreaterThanOrEqual(44);

  // Compact chrome: starter chips step aside, the composer stays.
  await expect(section.locator('.claudian-mode-quick-row')).toBeHidden();
  await expect(section.locator('.harness-composer')).toBeVisible();

  // While away, the pill owns "end": the rail drops its own end button.
  await expect(section.locator('.claudian-nav-btn-bottom')).toBeHidden();
  await expect(section.locator('.claudian-nav-btn-top')).toBeVisible();
});

test('the library search field has one border and no inner focus ring', async ({ page }, testInfo) => {
  const search = page.locator('[data-vis="library-search"] .claudian-preview-search');
  const input = search.locator('.claudian-preview-search-input');
  await input.focus();
  const ring = await input.evaluate((element) => {
    const style = getComputedStyle(element);
    return { boxShadow: style.boxShadow, borderTopWidth: style.borderTopWidth };
  });
  expect(ring).toEqual({ boxShadow: 'none', borderTopWidth: '0px' });
  await expect(search.locator('.claudian-preview-search-count')).toHaveText('3 von 9');
  if (testInfo.project.name === 'w320') {
    const box = await search.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
});

test('matches are marked in names and folders', async ({ page }) => {
  const marks = page.locator('[data-vis="library-search"] mark.claudian-preview-mark');
  await expect(marks).toHaveCount(5);
  const weight = await marks.first().evaluate((element) => getComputedStyle(element).fontWeight);
  expect(Number(weight)).toBeGreaterThanOrEqual(650);
});

test('thumbnails and badges share one fixed box, so rows never shift', async ({ page }) => {
  const section = page.locator('[data-vis="library-thumbnails"]');
  const boxes = await section.locator('.claudian-preview-row-media').evaluateAll((elements) =>
    elements.map((element) => {
      const box = element.getBoundingClientRect();
      return [Math.round(box.width), Math.round(box.height)];
    }));
  expect(boxes.length).toBeGreaterThan(0);
  for (const box of boxes) expect(box).toEqual([40, 40]);

  const rowHeights = await section.locator('.claudian-preview-row').evaluateAll((elements) =>
    elements.map((element) => Math.round(element.getBoundingClientRect().height)));
  expect(new Set(rowHeights).size).toBe(1);

  for (const img of await section.locator('img.claudian-preview-thumb').all()) {
    await expect(img).toHaveAttribute('loading', 'lazy');
    await expect(img).toHaveAttribute('width', '40');
    await expect(img).toHaveAttribute('height', '40');
  }
  // A failed image leaves only its badge.
  const failed = section.locator('.claudian-preview-row-media[data-thumb="failed"]');
  await expect(failed.locator('img')).toHaveCount(0);
  await expect(failed.locator('.claudian-preview-row-icon')).toBeVisible();
});

test('library rows neutralize Obsidian button chrome and never overflow sideways', async ({ page }) => {
  for (const section of ['library-arrows', 'library-search', 'library-thumbnails']) {
    const rows = page.locator(`[data-vis="${section}"] .claudian-preview-row`);
    for (const row of await rows.all()) {
      const geometry = await row.evaluate((element) => {
        const style = getComputedStyle(element);
        const text = element.querySelector('.claudian-preview-row-text')!.getBoundingClientRect();
        const actions = element.querySelector('.claudian-preview-row-actions')!.getBoundingClientRect();
        return {
          overflow: element.scrollWidth - element.clientWidth,
          textRight: text.right,
          actionsLeft: actions.left,
          boxShadow: style.boxShadow,
          background: style.backgroundColor,
        };
      });
      expect(geometry.overflow).toBeLessThanOrEqual(1);
      expect(geometry.textRight).toBeLessThanOrEqual(geometry.actionsLeft + TOLERANCE);
      expect(geometry.boxShadow).toBe('none');
      expect(geometry.background).toBe('rgba(0, 0, 0, 0)');
    }
    const list = page.locator(`[data-vis="${section}"] .claudian-preview-content`);
    const overflow = await list.evaluate((element) => element.scrollWidth - element.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  }
});

for (const section of SECTIONS) {
  test(`library ${section} matches snapshot`, async ({ page }, testInfo) => {
    await isolate(page, section);
    const el = page.locator(`[data-vis="${section}"]`);
    await expect(el).toBeVisible();
    await expect(el).toHaveScreenshot(`${section}-${testInfo.project.name}.png`, { maxDiffPixelRatio: 0.01 });
  });
}

for (const section of LIGHT_SECTIONS) {
  test(`library ${section} (light) matches snapshot`, async ({ page }, testInfo) => {
    await page.evaluate(() => document.body.classList.replace('theme-dark', 'theme-light'));
    await isolate(page, section);
    const el = page.locator(`[data-vis="${section}"]`);
    await expect(el).toBeVisible();
    await expect(el).toHaveScreenshot(`${section}-light-${testInfo.project.name}.png`, { maxDiffPixelRatio: 0.01 });
  });
}
