import { pathToFileURL } from 'node:url';
import path from 'node:path';

import { expect, type Page, test } from '@playwright/test';
import { buildSync } from 'esbuild';

const HARNESS_URL = pathToFileURL(path.join(__dirname, 'components.html')).href;

const TODO_SECTIONS = ['todo-mixed', 'todo-many', 'todo-done', 'todo-long'] as const;
const TODO_LIGHT_SECTIONS = ['todo-mixed', 'todo-many'] as const;

let todoBundle: string | null = null;

/** The production todo renderers, bundled once per worker with the obsidian shim. */
function getTodoBundle(): string {
  todoBundle ??= buildSync({
    alias: { obsidian: path.join(__dirname, 'obsidianShim.ts') },
    bundle: true,
    entryPoints: [path.join(__dirname, 'todoHarness.ts')],
    format: 'iife',
    logLevel: 'silent',
    platform: 'browser',
    target: 'chrome120',
    write: false,
  }).outputFiles[0].text;
  return todoBundle;
}

async function mountTodoSection(page: Page, section: string, theme: 'dark' | 'light' = 'dark'): Promise<void> {
  if (theme === 'light') {
    await page.evaluate(() => document.body.classList.replace('theme-dark', 'theme-light'));
  }
  await page.evaluate((visible) => {
    document.querySelectorAll<HTMLElement>('.harness-section').forEach((candidate) => {
      if (candidate.dataset.vis !== visible) candidate.remove();
    });
  }, section);
  await page.addScriptTag({ content: getTodoBundle() });
  await page.evaluate(() => (window as unknown as { __mountTodoFixtures: () => void }).__mountTodoFixtures());
  // The list reveals the running task on the next frame.
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.mouse.move(1, 1);
}

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

const CONTROL_SECTIONS = ['fast-chip', 'model-picker', 'composer-toolbar', 'browser-activity', 'history-panel', 'history-search', 'subagent-cards', 'subagent-swarm', 'subagent-inspector', 'transcript-skeleton'] as const;

const PRESSURE_BANNERS = [
  'context-pressure-high',
  'context-pressure-critical',
  'context-pressure-estimated',
  'context-pressure-no-compact',
  'context-pressure-narrow',
] as const;
const PRESSURE_SECTIONS = [...PRESSURE_BANNERS, 'session-boundary'] as const;
const PRESSURE_LIGHT_SECTIONS = ['context-pressure-high', 'context-pressure-critical', 'context-pressure-narrow', 'session-boundary'] as const;

async function isolateSection(page: import('@playwright/test').Page, section: string): Promise<void> {
  await page.evaluate((visibleSection) => {
    document.querySelectorAll<HTMLElement>('.harness-section').forEach((candidate) => {
      if (candidate.dataset.vis !== visibleSection) candidate.remove();
    });
  }, section);
}
// Tab overview ("Offene Chats") and the tab bar with more tabs than fit.
const TAB_SECTIONS = ['tab-overview', 'tab-overview-filtered', 'tab-overview-narrow', 'tab-bar-overflow'] as const;
const TAB_LIGHT_SECTIONS = ['tab-overview', 'tab-bar-overflow'] as const;
const OVERVIEW_SECTIONS = ['tab-overview', 'tab-overview-filtered', 'tab-overview-narrow'] as const;

/** Fixtures captured in isolation; legacy snapshots are taken without them. */
// Goal fixtures are mounted and captured by goal.spec.ts.
const GOAL_FIXTURE_SECTIONS = ['goal-native', 'goal-settled', 'goal-rounds'] as const;
const ISOLATED_SECTIONS = [...CONTROL_SECTIONS, ...TAB_SECTIONS, ...GOAL_FIXTURE_SECTIONS];

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

test('speed states remain distinct and touch targets survive theme overrides', async ({ page }, testInfo) => {
  const chips = page.locator('[data-vis="fast-chip"] .harness-row .claudian-service-tier-button');
  const styles = await chips.evaluateAll((elements) => elements.map((element) => {
    const style = getComputedStyle(element);
    return { color: style.color, background: style.backgroundColor, height: element.getBoundingClientRect().height };
  }));
  expect(styles[1].color).not.toBe(styles[0].color);
  expect(styles[2].background).not.toBe(styles[0].background);
  if (testInfo.project.name === 'w320') {
    for (const style of styles) expect(style.height).toBeGreaterThanOrEqual(44);
  }
});

test('library rows keep separate names and actions without horizontal overflow', async ({ page }) => {
  const rows = page.locator('[data-vis="document-library-mobile"] .claudian-preview-row');
  await expect(rows).toHaveCount(2);
  for (const row of await rows.all()) {
    await expect(row.locator('.claudian-preview-card-btn')).toHaveCount(3);
    const geometry = await row.evaluate((element) => {
      const text = element.querySelector('.claudian-preview-row-text')!.getBoundingClientRect();
      const actions = element.querySelector('.claudian-preview-row-actions')!.getBoundingClientRect();
      return { overflow: element.scrollWidth - element.clientWidth, textRight: text.right, actionsLeft: actions.left };
    });
    expect(geometry.overflow).toBeLessThanOrEqual(1);
    expect(geometry.textRight).toBeLessThanOrEqual(geometry.actionsLeft);
  }
});

// Regression: rows inherited Obsidian's generic button chrome (grey fill, fixed
// height), and the search input kept the theme's focus ring inside its own.
test('history rows are list rows, not buttons, and the search field has one ring', async ({ page }) => {
  const panel = page.locator('[data-vis="history-panel"]');
  const content = panel.locator('.claudian-history-item:not(.active) .claudian-history-item-content').first();
  const button = await content.evaluate((element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, boxShadow: style.boxShadow, height: element.getBoundingClientRect().height };
  });
  expect(button.background).toBe('rgba(0, 0, 0, 0)');
  expect(button.boxShadow).toBe('none');
  expect(button.height).toBeGreaterThan(30);

  const input = panel.locator('.claudian-history-search-input');
  await input.focus();
  const ring = await input.evaluate((element) => {
    const style = getComputedStyle(element);
    return { boxShadow: style.boxShadow, borderTopWidth: style.borderTopWidth };
  });
  expect(ring).toEqual({ boxShadow: 'none', borderTopWidth: '0px' });
});

test('history panel keeps rows inside the pane without horizontal overflow', async ({ page }) => {
  for (const vis of ['history-panel', 'history-search']) {
    const list = page.locator(`[data-vis="${vis}"] .claudian-history-list`);
    const overflow = await list.evaluate((element) => element.scrollWidth - element.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  }
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
    await page.locator(ISOLATED_SECTIONS.map((name) => `[data-vis="${name}"]`).join(',')).evaluateAll((elements) => {
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

// ---- Context-pressure warning ------------------------------------------------

/** WCAG relative-luminance contrast between two CSS colours (rgb()/color(srgb)/hex). */
async function contrastOf(page: import('@playwright/test').Page, selector: string, backgroundVar: string): Promise<number[]> {
  return page.evaluate(({ selector: sel, backgroundVar: bgVar }) => {
    const parse = (value: string): [number, number, number] => {
      const text = value.trim();
      if (text.startsWith('#')) {
        const hex = text.slice(1);
        return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
      }
      const numbers = text.match(/[\d.]+/g)!.map(Number);
      return text.startsWith('color(') ? [numbers[0], numbers[1], numbers[2]] : [numbers[0] / 255, numbers[1] / 255, numbers[2] / 255];
    };
    const luminance = ([r, g, b]: [number, number, number]) => {
      const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
      return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    };
    const background = luminance(parse(getComputedStyle(document.body).getPropertyValue(bgVar)));
    return [...document.querySelectorAll<HTMLElement>(sel)]
      .filter((element) => element.offsetParent !== null)
      .map((element) => {
        const foreground = luminance(parse(getComputedStyle(element).color));
        const [light, dark] = foreground > background ? [foreground, background] : [background, foreground];
        return (light + 0.05) / (dark + 0.05);
      });
  }, { selector, backgroundVar });
}

test('context-pressure banners keep text and actions inside their pane without clipping', async ({ page }) => {
  for (const section of PRESSURE_BANNERS) {
    const banner = page.locator(`[data-vis="${section}"] .claudian-context-pressure`);
    await expect(banner).toBeVisible();
    const geometry = await banner.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const within = (node: Element) => {
        const rect = node.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return true;
        return rect.left >= box.left - 0.5 && rect.right <= box.right + 0.5
          && rect.top >= box.top - 0.5 && rect.bottom <= box.bottom + 0.5;
      };
      const textNodes = element.querySelectorAll<HTMLElement>(
        '.claudian-context-pressure-title, .claudian-context-pressure-percent, .claudian-context-pressure-detail, .claudian-context-pressure-action, .claudian-context-pressure-note',
      );
      return {
        overflow: element.scrollWidth - element.clientWidth,
        outside: [...element.querySelectorAll('*')].filter((node) => !within(node)).map((node) => node.getAttribute('class')),
        clipped: [...textNodes]
          .filter((node) => node.offsetParent !== null)
          .filter((node) => node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1)
          .map((node) => node.getAttribute('class')),
      };
    });
    expect(geometry.overflow, section).toBeLessThanOrEqual(1);
    expect(geometry.outside, section).toEqual([]);
    expect(geometry.clipped, section).toEqual([]);
  }
});

test('context-pressure actions wrap to full-width rows in a ~300px sidebar', async ({ page }) => {
  const host = page.locator('[data-vis="context-pressure-narrow"] .claudian-context-pressure-host');
  const result = await host.evaluate((element) => {
    const actions = element.querySelector('.claudian-context-pressure-actions')!.getBoundingClientRect();
    const buttons = [...element.querySelectorAll<HTMLElement>('.claudian-context-pressure-action')]
      .map((button) => button.getBoundingClientRect());
    return {
      hostWidth: element.getBoundingClientRect().width,
      actions: { left: actions.left, right: actions.right },
      buttons: buttons.map((rect) => ({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom })),
    };
  });
  expect(result.hostWidth).toBeLessThanOrEqual(300.5);
  expect(result.buttons).toHaveLength(2);
  for (const button of result.buttons) {
    expect(button.left).toBeGreaterThanOrEqual(result.actions.left - 0.5);
    expect(button.right).toBeLessThanOrEqual(result.actions.right + 0.5);
  }
  // Stacked, not squeezed side by side.
  expect(result.buttons[1].top).toBeGreaterThanOrEqual(result.buttons[0].bottom - 0.5);
});

test('context-pressure actions keep coarse-pointer touch targets', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'w320');
  const heights = await page.locator('.claudian-context-pressure-action:visible').evaluateAll((elements) => (
    elements.map((element) => element.getBoundingClientRect().height)
  ));
  expect(heights.length).toBeGreaterThan(0);
  for (const height of heights) expect(height).toBeGreaterThanOrEqual(44);
});

test('context-pressure actions have designed focus and disabled states', async ({ page }) => {
  const primary = page.locator('[data-vis="context-pressure-high"] .claudian-context-pressure-action.is-primary');
  await page.keyboard.press('Tab');
  await primary.focus();
  const focus = await primary.evaluate((element) => ({
    visible: element.matches(':focus-visible'),
    outlineStyle: getComputedStyle(element).outlineStyle,
    outlineWidth: getComputedStyle(element).outlineWidth,
  }));
  expect(focus.visible).toBe(true);
  expect(focus.outlineStyle).toBe('solid');
  expect(focus.outlineWidth).toBe('2px');

  const opacity = (selector: string) => page.locator(selector).first().evaluate((element) => Number(getComputedStyle(element).opacity));
  expect(await opacity('[data-vis="context-pressure-narrow"] .claudian-context-pressure-action')).toBeLessThan(1);
  expect(await opacity('[data-vis="context-pressure-high"] .claudian-context-pressure-action')).toBe(1);
});

test('context-pressure entrance is a short compositor-only animation that respects reduced motion', async ({ page }) => {
  const banner = page.locator('[data-vis="context-pressure-high"] .claudian-context-pressure');
  expect(await banner.evaluate((element) => getComputedStyle(element).animationName)).toBe('none');

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const motion = await banner.evaluate((element) => {
    const style = getComputedStyle(element);
    // file:// stylesheets hide cssRules; the running animation exposes its keyframes.
    const animation = element.getAnimations().find((candidate) => (
      (candidate as CSSAnimation).animationName === style.animationName
    ));
    const animated = new Set<string>();
    for (const frame of animation?.effect instanceof KeyframeEffect ? animation.effect.getKeyframes() : []) {
      for (const key of Object.keys(frame)) {
        if (!['offset', 'computedOffset', 'easing', 'composite'].includes(key)) animated.add(key);
      }
    }
    return { name: style.animationName, duration: style.animationDuration, properties: [...animated].sort() };
  });
  expect(motion.name).toBe('cl-pressure-in');
  const seconds = parseFloat(motion.duration);
  expect(seconds).toBeGreaterThanOrEqual(0.15);
  expect(seconds).toBeLessThanOrEqual(0.22);
  expect(motion.properties).toEqual(['opacity', 'transform']);
});

test('context-pressure text stays readable in dark and light themes', async ({ page }) => {
  for (const theme of ['theme-dark', 'theme-light']) {
    await page.evaluate((next) => { document.body.className = next; }, theme);
    const selector = '.claudian-context-pressure-title, .claudian-context-pressure-percent, .claudian-context-pressure-usage, .claudian-context-pressure-text, .claudian-context-pressure-action.is-primary:not(:disabled)';
    const ratios = await contrastOf(page, selector, '--background-secondary');
    expect(ratios.length, theme).toBeGreaterThan(0);
    for (const ratio of ratios) expect(ratio, theme).toBeGreaterThanOrEqual(4.5);
  }
});

for (const section of PRESSURE_SECTIONS) {
  test(`component ${section} matches snapshot`, async ({ page }, testInfo) => {
    await isolateSection(page, section);
    await page.mouse.move(1, 1);
    const el = page.locator(`[data-vis="${section}"]`);
    await expect(el).toBeVisible();
    await expect(el).toHaveScreenshot(`${section}-${testInfo.project.name}.png`, { maxDiffPixelRatio: 0.01 });
  });
}

// ── Tab overview and tab bar ───────────────────────────────────────────────
// Geometry, not pixels, is what these assert: nothing leaves the pane, nothing
// is clipped, the active row is on screen, the "+N" chip counts what is hidden.

const EDGE = 0.5;

test('the tab overview stays inside its pane and never clips a row', async ({ page }) => {
  for (const vis of OVERVIEW_SECTIONS) {
    const geometry = await page.locator(`[data-vis="${vis}"]`).evaluate((section) => {
      const rect = (element: Element) => {
        const box = element.getBoundingClientRect();
        return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height };
      };
      const panelEl = section.querySelector('.claudian-tab-overview')!;
      const listEl = section.querySelector('.claudian-tab-overview-list')!;
      const rows = [...section.querySelectorAll('.claudian-tab-overview-row')].map((row) => {
        const title = row.querySelector('.claudian-tab-overview-title')!;
        const parts = [...row.querySelectorAll([
          '.claudian-tab-overview-avatar', '.claudian-tab-overview-title', '.claudian-tab-overview-model',
          '.claudian-tab-overview-status', '.claudian-tab-overview-chip', '.claudian-tab-overview-key',
          '.claudian-tab-overview-close', '.claudian-tab-overview-confirm',
        ].join(','))].filter((part) => getComputedStyle(part).display !== 'none').map(rect);
        return {
          box: rect(row),
          parts,
          active: row.classList.contains('is-active'),
          titleClipped: Math.max(title.scrollWidth - title.clientWidth, title.scrollHeight - title.clientHeight),
        };
      });
      return {
        host: rect(section.querySelector('.harness-tab-host')!),
        panel: rect(panelEl),
        list: rect(listEl),
        listOverflow: listEl.scrollWidth - listEl.clientWidth,
        viewportWidth: window.innerWidth,
        rows,
      };
    });

    // Inside the pane it belongs to, and inside the window.
    expect(geometry.panel.left).toBeGreaterThanOrEqual(geometry.host.left - EDGE);
    expect(geometry.panel.right).toBeLessThanOrEqual(geometry.host.right + EDGE);
    expect(geometry.panel.top).toBeGreaterThanOrEqual(geometry.host.top - EDGE);
    expect(geometry.panel.left).toBeGreaterThanOrEqual(0);
    expect(geometry.panel.right).toBeLessThanOrEqual(geometry.viewportWidth + EDGE);
    expect(geometry.listOverflow).toBeLessThanOrEqual(1);

    expect(geometry.rows.length).toBeGreaterThan(0);
    for (const row of geometry.rows) {
      // The whole title, never cut: this is what the tab bar hides.
      expect(row.titleClipped).toBeLessThanOrEqual(1);
      for (const part of row.parts) {
        expect(part.left).toBeGreaterThanOrEqual(row.box.left - EDGE);
        expect(part.right).toBeLessThanOrEqual(row.box.right + EDGE);
        expect(part.bottom).toBeLessThanOrEqual(row.box.bottom + EDGE);
      }
    }

    const active = geometry.rows.find((row) => row.active);
    if (active) {
      expect(active.box.top).toBeGreaterThanOrEqual(geometry.list.top - EDGE);
      expect(active.box.bottom).toBeLessThanOrEqual(geometry.list.bottom + EDGE);
    }
  }
});

test('the filtered overview keeps the query and shows only matching tabs', async ({ page }) => {
  const section = page.locator('[data-vis="tab-overview-filtered"]');
  await expect(section.locator('.claudian-tab-overview-search-input')).toHaveValue('firewall');
  await expect(section.locator('.claudian-tab-overview-row')).toHaveCount(2);
  await expect(section.locator('.claudian-tab-overview-row.is-active')).toHaveCount(1);
});

test('a narrow sidebar drops the key legend but keeps the close question inside its row', async ({ page }) => {
  const section = page.locator('[data-vis="tab-overview-narrow"]');
  const geometry = await section.evaluate((root) => {
    const panel = root.querySelector('.claudian-tab-overview')!.getBoundingClientRect();
    const confirm = root.querySelector('.claudian-tab-overview-row.is-confirming .claudian-tab-overview-confirm')!;
    const row = confirm.closest('.claudian-tab-overview-row')!.getBoundingClientRect();
    const buttons = [...confirm.querySelectorAll('button')].map((button) => button.getBoundingClientRect());
    return {
      panelWidth: panel.width,
      hintsDisplay: getComputedStyle(root.querySelector('.claudian-tab-overview-hints')!).display,
      rowLeft: row.left,
      rowRight: row.right,
      buttons: buttons.map((box) => ({ left: box.left, right: box.right })),
      confirmOverflow: confirm.scrollWidth - confirm.clientWidth,
    };
  });

  expect(geometry.panelWidth).toBeLessThanOrEqual(300);
  expect(geometry.hintsDisplay).toBe('none');
  expect(geometry.confirmOverflow).toBeLessThanOrEqual(1);
  for (const button of geometry.buttons) {
    expect(button.left).toBeGreaterThanOrEqual(geometry.rowLeft - EDGE);
    expect(button.right).toBeLessThanOrEqual(geometry.rowRight + EDGE);
  }
});

test('a crowded tab bar fades its edges and counts hidden tabs in the "+N" chip', async ({ page }, testInfo) => {
  const geometry = await page.locator('[data-vis="tab-bar-overflow"]').evaluate((root) => {
    const strip = root.querySelector<HTMLElement>('.claudian-tab-badges')!;
    const chip = root.querySelector<HTMLElement>('.claudian-tab-overflow-chip')!;
    const bar = root.querySelector('.claudian-tab-bar-container')!.getBoundingClientRect();
    const navContent = root.querySelector('.claudian-input-nav-content')!;
    const stripBox = strip.getBoundingClientRect();
    const start = strip.scrollLeft;
    const end = start + strip.clientWidth;
    let hidden = 0;
    let hiddenWaiting = 0;
    for (const badge of [...strip.children] as HTMLElement[]) {
      const visible = Math.min(badge.offsetLeft + badge.offsetWidth, end) - Math.max(badge.offsetLeft, start);
      if (visible < badge.offsetWidth / 2) {
        hidden++;
        if (badge.dataset.attention) hiddenWaiting++;
      }
    }
    const active = strip.querySelector('.claudian-tab-badge-active')!.getBoundingClientRect();
    const dots = [...strip.querySelectorAll('.claudian-tab-attention-dot')].map((dot) => dot.getBoundingClientRect().top);
    const chipBox = chip.getBoundingClientRect();
    const overviewButton = root.querySelector<HTMLElement>('.claudian-tab-overview-btn')!;
    return {
      handedOver: getComputedStyle(strip).display === 'none',
      overviewButtonVisible: overviewButton.getBoundingClientRect().width > 0,
      overviewCount: overviewButton.querySelector('.claudian-tab-overview-btn-count')!.textContent,
      classes: [...strip.classList],
      chipText: chip.textContent,
      chipVisible: getComputedStyle(chip).display !== 'none',
      chipAttention: chip.classList.contains('has-attention'),
      chipRight: chipBox.right,
      barRight: bar.right,
      hidden,
      hiddenWaiting,
      navOverflow: navContent.scrollWidth - navContent.clientWidth,
      stripLeft: stripBox.left,
      stripRight: stripBox.right,
      stripTop: stripBox.top,
      activeLeft: active.left,
      activeRight: active.right,
      dotTops: dots,
    };
  });

  expect(geometry.navOverflow).toBeLessThanOrEqual(1);
  expect(geometry.overviewButtonVisible).toBe(true);
  expect(geometry.overviewCount).toBe('9');

  // Phone width with 44px touch buttons: less than one badge plus the chip
  // would remain, so the strip steps aside and the overview button switches.
  if (testInfo.project.name === 'w320') {
    expect(geometry.handedOver).toBe(true);
    expect(geometry.chipVisible).toBe(false);
    return;
  }

  expect(geometry.handedOver).toBe(false);
  expect(geometry.hidden).toBeGreaterThan(0);
  expect(geometry.chipVisible).toBe(true);
  expect(geometry.chipText).toBe(`+${geometry.hidden}`);
  expect(geometry.chipAttention).toBe(geometry.hiddenWaiting > 0);
  expect(geometry.classes).toContain('has-overflow-end');
  expect(geometry.chipRight).toBeLessThanOrEqual(geometry.barRight + EDGE);
  expect(geometry.navOverflow).toBeLessThanOrEqual(1);
  // The active tab is fully on screen, and no corner mark is cut by the scroller.
  expect(geometry.activeLeft).toBeGreaterThanOrEqual(geometry.stripLeft - EDGE);
  expect(geometry.activeRight).toBeLessThanOrEqual(geometry.stripRight + EDGE);
  for (const top of geometry.dotTops) expect(top).toBeGreaterThanOrEqual(geometry.stripTop - EDGE);
});

test('attention badges are tinted by their reason, not all alike', async ({ page }) => {
  const styles = await page.locator('[data-vis="tab-bar-overflow"] .claudian-tab-badge').evaluateAll((badges) =>
    badges.map((badge) => ({
      attention: (badge as HTMLElement).dataset.attention ?? null,
      background: getComputedStyle(badge).backgroundColor,
      dot: badge.querySelector('.claudian-tab-attention-dot')
        ? getComputedStyle(badge.querySelector('.claudian-tab-attention-dot')!).backgroundColor
        : null,
    })));
  const idle = styles.find((style) => !style.attention)!;
  const byReason = new Map(styles.filter((style) => style.attention).map((style) => [style.attention, style]));

  expect([...byReason.keys()].sort()).toEqual(['failed', 'finished', 'input']);
  for (const style of byReason.values()) expect(style.background).not.toBe(idle.background);
  expect(new Set([...byReason.values()].map((style) => style.dot)).size).toBe(3);
});

for (const section of TAB_SECTIONS) {
  test(`component ${section} matches snapshot`, async ({ page }, testInfo) => {
    await isolateSection(page, section);
    await page.mouse.move(1, 1);
    const el = page.locator(`[data-vis="${section}"]`);
    await expect(el).toBeVisible();
    await expect(el).toHaveScreenshot(`${section}-${testInfo.project.name}.png`, { maxDiffPixelRatio: 0.01 });
  });
}

// ── Todo list: geometry first (these assertions are what verify the design;
// the snapshots only guard against drift). ────────────────────────────────

for (const section of TODO_SECTIONS) {
  test(`todo ${section} keeps every row inside its surface`, async ({ page }) => {
    await mountTodoSection(page, section);
    const root = page.locator(`[data-vis="${section}"]`);
    await expect(root.locator('.claudian-todo-summary').first()).toBeVisible();

    const offenders = await root.evaluate((element) => {
      const problems: string[] = [];
      const tolerance = 0.5;
      const describe = (el: Element) => `${el.className} "${(el.textContent ?? '').slice(0, 40)}"`;
      for (const el of element.querySelectorAll<HTMLElement>(
        '.claudian-todo-item, .claudian-todo-header, .claudian-tool-header, .claudian-todo-summary, .claudian-todo-scroll, .claudian-todo-group-toggle',
      )) {
        if (el.scrollWidth - el.clientWidth > 1) problems.push(`overflow ${describe(el)}`);
      }
      for (const scroller of element.querySelectorAll<HTMLElement>('.claudian-todo-scroll')) {
        const box = scroller.getBoundingClientRect();
        for (const row of scroller.querySelectorAll<HTMLElement>('.claudian-todo-item, .claudian-todo-group-toggle')) {
          const rect = row.getBoundingClientRect();
          if (rect.width === 0) continue;
          if (rect.left < box.left - tolerance || rect.right > box.right + tolerance) problems.push(`row outside list ${describe(row)}`);
          for (const part of row.querySelectorAll<HTMLElement>('.claudian-todo-text, .claudian-todo-priority')) {
            const partRect = part.getBoundingClientRect();
            if (partRect.right > rect.right + tolerance) problems.push(`part outside row ${describe(part)}`);
          }
        }
      }
      for (const header of element.querySelectorAll<HTMLElement>('.claudian-todo-header, .claudian-tool-header')) {
        const box = header.getBoundingClientRect();
        for (const part of header.children) {
          const rect = (part as HTMLElement).getBoundingClientRect();
          if (rect.width > 0 && rect.right > box.right + tolerance) problems.push(`header part clipped ${describe(part)}`);
        }
      }
      if (element.scrollWidth - element.clientWidth > 1) problems.push('section overflows');
      return problems;
    });
    expect(offenders).toEqual([]);
  });
}

test('todo many: lists are height-capped and keep the running task in view', async ({ page }) => {
  await mountTodoSection(page, 'todo-many');
  const root = page.locator('[data-vis="todo-many"]');

  const panelToggle = root.locator('.claudian-status-panel-todos .claudian-todo-group-toggle');
  await expect(panelToggle).toHaveText('5 erledigt');
  await expect(panelToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(root.locator('.claudian-tool-call--todo .claudian-todo-group-toggle')).toHaveAttribute('aria-expanded', 'true');

  const lists = await root.locator('.claudian-todo-scroll').evaluateAll((scrollers) => scrollers.map((scroller) => {
    const box = scroller.getBoundingClientRect();
    const active = scroller.querySelector<HTMLElement>('.claudian-todo-in_progress')!.getBoundingClientRect();
    return {
      activeBottom: active.bottom,
      activeTop: active.top,
      bottom: box.bottom,
      clientHeight: scroller.clientHeight,
      maxHeight: parseFloat(getComputedStyle(scroller).maxHeight),
      scrollHeight: scroller.scrollHeight,
      scrollTop: scroller.scrollTop,
      top: box.top,
    };
  }));
  expect(lists).toHaveLength(2);
  for (const list of lists) {
    expect(list.maxHeight).toBeGreaterThan(0);
    expect(list.clientHeight).toBeLessThanOrEqual(list.maxHeight + 0.5);
    // Twelve steps never fit: the cap is real and the list scrolls.
    expect(list.scrollHeight).toBeGreaterThan(list.clientHeight);
    expect(list.activeTop).toBeGreaterThanOrEqual(list.top - 0.5);
    expect(list.activeBottom).toBeLessThanOrEqual(list.bottom + 0.5);
  }
  // With the finished group open the running task sits below the fold, so the
  // card must have scrolled itself (and only itself) to it.
  expect(lists[1].scrollTop).toBeGreaterThan(0);
});

test('todo long: long steps wrap instead of being cut off', async ({ page }) => {
  await mountTodoSection(page, 'todo-long');
  const card = page.locator('[data-vis="todo-long"] .claudian-tool-call--todo');
  const measured = await card.evaluate((element) => {
    const texts = [...element.querySelectorAll<HTMLElement>('.claudian-todo-text')];
    const line = parseFloat(getComputedStyle(texts[0]).lineHeight);
    return {
      heights: texts.map((text) => text.getBoundingClientRect().height),
      line,
      priorities: [...element.querySelectorAll('.claudian-todo-priority-label')].map((chip) => chip.textContent),
    };
  });
  expect(measured.line).toBeGreaterThan(0);
  // The running step needs more than one line at every width.
  expect(measured.heights[1]).toBeGreaterThan(measured.line * 1.5);
  expect(measured.priorities).toEqual(['Hoch', 'Hoch', 'Mittel', 'Niedrig']);
});

test('todo mixed: collapsed lists are closed to layout and assistive tech; the header opens them by keyboard', async ({ page }) => {
  await mountTodoSection(page, 'todo-mixed');
  const panels = page.locator('[data-vis="todo-mixed"] .claudian-status-panel-todos');
  const read = (index: number) => panels.nth(index).evaluate((panel) => {
    const content = panel.querySelector<HTMLElement>('.claudian-status-panel-content')!;
    return { height: content.getBoundingClientRect().height, visibility: getComputedStyle(content).visibility };
  });

  expect(await read(0)).toEqual({ height: 0, visibility: 'hidden' });
  const opened = await read(1);
  expect(opened.visibility).toBe('visible');
  expect(opened.height).toBeGreaterThan(40);

  const header = panels.nth(0).locator('.claudian-todo-header');
  await header.focus();
  await page.keyboard.press('Enter');
  await expect(header).toHaveAttribute('aria-expanded', 'true');
  await expect(header).toHaveAttribute('aria-label', 'Aufgabenliste einklappen – 2 von 5 erledigt');
  expect((await read(0)).visibility).toBe('visible');
});

for (const section of TODO_SECTIONS) {
  test(`component ${section} matches snapshot`, async ({ page }, testInfo) => {
    await mountTodoSection(page, section);
    const el = page.locator(`[data-vis="${section}"]`);
    await expect(el).toBeVisible();
    await expect(el).toHaveScreenshot(`${section}-${testInfo.project.name}.png`, { maxDiffPixelRatio: 0.01 });
  });
}

for (const section of PRESSURE_LIGHT_SECTIONS) {
  test(`component ${section} (light) matches snapshot`, async ({ page }, testInfo) => {
    await page.evaluate(() => document.body.classList.replace('theme-dark', 'theme-light'));
    await isolateSection(page, section);
    await page.mouse.move(1, 1);
    const el = page.locator(`[data-vis="${section}"]`);
    await expect(el).toBeVisible();
    await expect(el).toHaveScreenshot(`${section}-light-${testInfo.project.name}.png`, { maxDiffPixelRatio: 0.01 });
  });
}

for (const section of TAB_LIGHT_SECTIONS) {
  test(`component ${section} (light) matches snapshot`, async ({ page }, testInfo) => {
    await page.evaluate(() => document.body.classList.replace('theme-dark', 'theme-light'));
    await isolateSection(page, section);
    await page.mouse.move(1, 1);
    const el = page.locator(`[data-vis="${section}"]`);
    await expect(el).toBeVisible();
    await expect(el).toHaveScreenshot(`${section}-light-${testInfo.project.name}.png`, { maxDiffPixelRatio: 0.01 });
  });
}

for (const section of TODO_LIGHT_SECTIONS) {
  test(`component ${section} (light) matches snapshot`, async ({ page }, testInfo) => {
    await mountTodoSection(page, section, 'light');
    const el = page.locator(`[data-vis="${section}"]`);
    await expect(el).toBeVisible();
    await expect(el).toHaveScreenshot(`${section}-light-${testInfo.project.name}.png`, { maxDiffPixelRatio: 0.01 });
  });
}
