import { pathToFileURL } from 'node:url';
import path from 'node:path';

import { expect, type Page, test } from '@playwright/test';
import { buildSync } from 'esbuild';

const HARNESS_URL = pathToFileURL(path.join(__dirname, 'components.html')).href;
const GOAL_SECTIONS = ['goal-native', 'goal-settled', 'goal-rounds'] as const;

let goalBundle: string | null = null;

/** The production GoalBanner and round divider, bundled once with the obsidian shim. */
function getGoalBundle(): string {
  goalBundle ??= buildSync({
    alias: { obsidian: path.join(__dirname, 'obsidianShim.ts') },
    bundle: true,
    entryPoints: [path.join(__dirname, 'goalHarness.ts')],
    format: 'iife',
    logLevel: 'silent',
    platform: 'browser',
    target: 'chrome120',
    write: false,
  }).outputFiles[0].text;
  return goalBundle;
}

async function mountGoalSection(page: Page, section: string, theme: 'dark' | 'light' = 'dark'): Promise<void> {
  await page.goto(HARNESS_URL);
  if (theme === 'light') {
    await page.evaluate(() => document.body.classList.replace('theme-dark', 'theme-light'));
  }
  await page.evaluate((visible) => {
    document.querySelectorAll<HTMLElement>('.harness-section').forEach((candidate) => {
      if (candidate.dataset.vis !== visible) candidate.remove();
    });
  }, section);
  await page.addScriptTag({ content: getGoalBundle() });
  await page.evaluate(() => (window as unknown as { __mountGoalFixtures: () => void }).__mountGoalFixtures());
  await page.mouse.move(1, 1);
}

// ── Geometry first: these assertions verify the design; snapshots guard drift. ──

test('native goal banners never overflow and keep status, provider and badge readable', async ({ page }) => {
  await mountGoalSection(page, 'goal-native');
  const banners = page.locator('.claudian-goal-banner');
  await expect(banners).toHaveCount(4);

  const boxes = await banners.evaluateAll((elements) => elements.map((el) => {
    const root = el.getBoundingClientRect();
    const inside = (selector: string) => {
      const child = el.querySelector<HTMLElement>(selector);
      if (!child || child.classList.contains('claudian-hidden')) return null;
      const box = child.getBoundingClientRect();
      return { left: box.left, right: box.right, width: box.width, text: child.textContent ?? '' };
    };
    return {
      width: root.width,
      left: root.left,
      right: root.right,
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      label: inside('.claudian-goal-banner-label'),
      loop: inside('.claudian-goal-banner-loop'),
      detail: inside('.claudian-goal-banner-detail'),
      actions: inside('.claudian-goal-banner-actions'),
      tone: el.getAttribute('data-tone'),
    };
  }));

  for (const box of boxes) {
    expect(box.scrollWidth).toBeLessThanOrEqual(box.clientWidth + 1);
    expect(box.label?.width ?? 0).toBeGreaterThan(20);
    expect(box.actions!.right).toBeLessThanOrEqual(box.right + 0.5);
  }
  const [codexLive, claudeRound, codexPaused, grokLoop] = boxes;
  expect(codexLive.loop?.text).toBe('nativ');
  expect(codexLive.label?.text).toBe('Ziel aktiv · Runde 3');
  expect(codexLive.detail?.text).toBe('41,8k / 120k Tokens · 9 Min.');
  expect(claudeRound.detail?.text).toContain('Noch nicht erfüllt');
  expect(codexPaused.tone).toBe('muted');
  expect(grokLoop.loop?.text).toBe('Claudian-Loop');
  expect(grokLoop.detail).toBeNull();
});

test('settled goals switch to semantic tones', async ({ page }) => {
  await mountGoalSection(page, 'goal-settled');
  const tones = await page.locator('.claudian-goal-banner').evaluateAll((elements) => elements.map((el) => ({
    tone: el.getAttribute('data-tone'),
    rail: getComputedStyle(el, '::before').backgroundImage,
  })));
  expect(tones.map((t) => t.tone)).toEqual(['success', 'warning', 'danger']);
  // Each tone re-tints its own rail instead of keeping the provider accent.
  expect(new Set(tones.map((t) => t.rail)).size).toBe(3);
});

test('goal round dividers fit the column and truncate long reasons', async ({ page }) => {
  await mountGoalSection(page, 'goal-rounds');
  const rounds = page.locator('.claudian-goal-round');
  await expect(rounds).toHaveCount(2);
  const geometry = await rounds.evaluateAll((elements) => elements.map((el) => {
    const pill = el.querySelector<HTMLElement>('.claudian-goal-round-pill')!.getBoundingClientRect();
    const row = el.getBoundingClientRect();
    const reason = el.querySelector<HTMLElement>('.claudian-goal-round-reason');
    return {
      pillInside: pill.left >= row.left - 0.5 && pill.right <= row.right + 0.5,
      reasonTruncated: reason ? reason.scrollWidth > reason.clientWidth : null,
      reasonWhiteSpace: reason ? getComputedStyle(reason).whiteSpace : null,
      height: row.height,
    };
  }));
  for (const round of geometry) {
    expect(round.pillInside).toBe(true);
    expect(round.height).toBeLessThan(40);
  }
  expect(geometry[0].reasonWhiteSpace).toBe('nowrap');
  expect(geometry[1].reasonTruncated).toBeNull();
});

for (const section of GOAL_SECTIONS) {
  test(`component ${section} matches snapshot`, async ({ page }, testInfo) => {
    await mountGoalSection(page, section);
    const el = page.locator(`[data-vis="${section}"]`);
    await expect(el).toBeVisible();
    await expect(el).toHaveScreenshot(`${section}-${testInfo.project.name}.png`, { maxDiffPixelRatio: 0.01 });
  });

  test(`component ${section} (light) matches snapshot`, async ({ page }, testInfo) => {
    await mountGoalSection(page, section, 'light');
    const el = page.locator(`[data-vis="${section}"]`);
    await expect(el).toBeVisible();
    await expect(el).toHaveScreenshot(`${section}-light-${testInfo.project.name}.png`, { maxDiffPixelRatio: 0.01 });
  });
}
