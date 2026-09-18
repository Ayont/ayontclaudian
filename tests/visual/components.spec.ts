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

const CONTROL_SECTIONS = ['fast-chip', 'model-picker', 'composer-toolbar', 'browser-activity'] as const;

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

test('code blocks never hide content behind a clipped, unscrollable overflow', async ({ page }) => {
  // A <pre> may scroll horizontally, or it may wrap — but it must never combine
  // `overflow-x: hidden` with real overflow, which silently truncates long lines
  // with no affordance to reach the rest.
  const offenders = await page.locator('.claudian-code-wrapper pre').evaluateAll((elements) =>
    elements.flatMap((element) => {
      const style = getComputedStyle(element);
      const scrollable = style.overflowX === 'auto' || style.overflowX === 'scroll';
      const overflowPx = element.scrollWidth - element.clientWidth;
      if (scrollable || overflowPx <= 1) return [];
      return [{
        variant: element.closest('.claudian-code-wrapper')?.className ?? '',
        overflowPx,
        overflowX: style.overflowX,
        codeWhiteSpace: getComputedStyle(element.querySelector('code') ?? element).whiteSpace,
      }];
    })
  );
  expect(offenders).toEqual([]);
});

test('a source chip stays readable from its first character', async ({ page }) => {
  // Buttons centre their text, so a label wider than the chip used to be clipped
  // at BOTH ends: "Audit-Report-2026-04-21-Easybell" showed as "dit-Report-2026-04-",
  // which names no note the user can recognise.
  const measured = await page.evaluate(() => {
    const read = (id: string) => {
      const el = document.getElementById(id)!;
      const style = getComputedStyle(el);
      return {
        textAlign: style.textAlign,
        clipped: el.scrollWidth - el.clientWidth,
        width: Math.round(el.getBoundingClientRect().width),
        title: el.getAttribute('title') ?? '',
      };
    };
    return { long: read('chip-long'), short: read('chip-short') };
  });

  // The label starts at the start, and nothing is hidden at either end.
  expect(['start', 'left']).toContain(measured.long.textAlign);
  expect(measured.long.clipped).toBeLessThanOrEqual(1);

  // Wide enough that a realistic note title is recognisable, not 16 characters.
  expect(measured.long.width).toBeGreaterThan(150);

  // A short label is never padded out to the cap.
  expect(measured.short.width).toBeLessThan(measured.long.width);
});

test('source chips wrap in a narrow pane instead of being squeezed to nonsense', async ({ page }) => {
  // In a sidebar two realistic note titles do not fit side by side. Shrinking
  // them to fit produced "bug-babtec-service-after-firewall-migr…", which names
  // no note; the row has to break instead.
  const measured = await page.evaluate(() => {
    const row = document.getElementById('chips-narrow')!;
    const read = (id: string) => {
      const el = document.getElementById(id)!;
      const box = el.getBoundingClientRect();
      return { top: Math.round(box.top), right: box.right, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
    };
    return {
      rowRight: row.getBoundingClientRect().right,
      rowOverflow: row.scrollWidth - row.clientWidth,
      a: read('chip-narrow-a'),
      b: read('chip-narrow-b'),
    };
  });

  // The row itself never scrolls sideways.
  expect(measured.rowOverflow).toBeLessThanOrEqual(1);

  // No chip is pushed past the right edge of its row.
  expect(measured.a.right).toBeLessThanOrEqual(measured.rowRight + 0.5);
  expect(measured.b.right).toBeLessThanOrEqual(measured.rowRight + 0.5);

  // Two long titles land on separate lines rather than sharing one.
  expect(measured.b.top).toBeGreaterThan(measured.a.top);
});

test('a source chip shows the whole note title, even when the pane is too narrow for one line', async ({ page }) => {
  // This is the case the user actually sees: a 43-character note title in a
  // sidebar. Squeezing it onto one line clipped it to
  // "bug-babtec-service-after-firewall-migr", which is not a title anybody can
  // act on — so the chip has to grow a second line instead.
  const measured = await page.evaluate(() => {
    const chip = document.getElementById('chip-tight')!;
    const row = document.getElementById('chips-tight')!;
    const probe = document.createElement('span');
    probe.textContent = 'Xg';
    probe.style.cssText = 'position:absolute;visibility:hidden;font:inherit';
    chip.appendChild(probe);
    const lineHeight = probe.getBoundingClientRect().height;
    probe.remove();
    return {
      clipped: chip.scrollWidth - chip.clientWidth,
      height: chip.getBoundingClientRect().height,
      lineHeight,
      rowOverflow: row.scrollWidth - row.clientWidth,
    };
  });

  // Nothing is hidden horizontally any more.
  expect(measured.clipped).toBeLessThanOrEqual(1);
  expect(measured.rowOverflow).toBeLessThanOrEqual(1);

  // The chip is taller than a single line, i.e. the title wrapped.
  expect(measured.height).toBeGreaterThan(measured.lineHeight * 1.5);
});

test('a split streaming block is styled exactly like the finished block', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'w1440', 'measure clamp only where the pane is wider than 78ch');

  // While streaming, paragraphs sit under .claudian-stream-committed/-tail
  // wrappers instead of directly under .claudian-text-block. If the message
  // rules only reach direct children, long answers lose their 78ch measure and
  // their paragraph gaps — and snap back when the stream ends.
  const measured = await page.evaluate(() => {
    const read = (id: string) => {
      const el = document.getElementById(id)!;
      const style = getComputedStyle(el);
      return {
        maxWidth: style.maxWidth,
        marginBottom: style.marginBottom,
        width: Math.round(el.getBoundingClientRect().width),
      };
    };
    return {
      committedA: read('split-committed-a'),
      committedB: read('split-committed-b'),
      tail: read('split-tail'),
      flatA: read('flat-a'),
      flatC: read('flat-c'),
    };
  });

  // The 78ch clamp must survive the wrappers.
  expect(measured.committedA.maxWidth).toBe(measured.flatA.maxWidth);
  expect(measured.committedA.maxWidth).not.toBe('none');
  expect(measured.tail.maxWidth).toBe(measured.flatA.maxWidth);
  expect(measured.committedA.width).toBe(measured.flatA.width);

  // A committed paragraph is never the last paragraph of the message, so it
  // must keep its gap — `p:last-child` must not swallow it per segment.
  expect(measured.committedA.marginBottom).not.toBe('0px');
  expect(measured.committedB.marginBottom).not.toBe('0px');

  // The true final paragraph still collapses its trailing margin.
  expect(measured.tail.marginBottom).toBe(measured.flatC.marginBottom);
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
