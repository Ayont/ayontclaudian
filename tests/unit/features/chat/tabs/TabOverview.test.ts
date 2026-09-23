import { createMockEl } from '@test/helpers/mockElement';

import { TabOverview, type TabOverviewCallbacks } from '@/features/chat/tabs/TabOverview';
import type { TabOverviewItem } from '@/features/chat/tabs/tabOverviewModel';

const NOW = Date.UTC(2026, 8, 23, 14, 0, 0);

function item(n: number, overrides: Partial<TabOverviewItem> = {}): TabOverviewItem {
  return {
    id: `tab-${n}`,
    index: n,
    title: `Chat ${n}`,
    providerId: 'claude',
    providerName: 'Claude',
    modelLabel: 'Opus 4.7',
    isActive: n === 1,
    isStreaming: false,
    streamingSince: null,
    attention: null,
    hasDraft: false,
    lastActivityAt: NOW - 3 * 60_000,
    contextPercent: null,
    todos: null,
    runningSubagents: 0,
    canClose: true,
    isEmpty: false,
    ...overrides,
  };
}

function keydown(target: any, key: string, extra: Record<string, unknown> = {}) {
  const event = { type: 'keydown', key, target, preventDefault: jest.fn(), stopPropagation: jest.fn(), ...extra };
  return event;
}

// An open overview ticks once a second; a leftover interval keeps Jest alive.
const created: TabOverview[] = [];

function setUp(initial: TabOverviewItem[], options: { canCreateTab?: boolean } = {}) {
  let items = initial;
  let perfNow = 100_000;
  const callbacks: jest.Mocked<TabOverviewCallbacks> = {
    getItems: jest.fn(() => items),
    onSelect: jest.fn(),
    onClose: jest.fn(),
    onNewTab: jest.fn(),
    canCreateTab: jest.fn(() => options.canCreateTab ?? true),
  };
  const hostEl = createMockEl();
  const overview = new TabOverview(hostEl, callbacks, { clock: () => ({ now: NOW, perfNow }) });
  created.push(overview);
  const panel = () => hostEl.querySelector('.claudian-tab-overview')!;
  const rows = () => hostEl.querySelectorAll('.claudian-tab-overview-row');
  const rowFor = (id: string) => rows().find((row: any) => row.getAttribute('data-tab-id') === id)!;
  const part = (row: any, cls: string) => row.querySelector(`.${cls}`);
  return {
    callbacks,
    hostEl,
    overview,
    panel,
    part,
    rowFor,
    rows,
    search: () => hostEl.querySelector('.claudian-tab-overview-search-input')!,
    setItems: (next: TabOverviewItem[]) => { items = next; },
    advancePerf: (ms: number) => { perfNow += ms; },
  };
}

afterEach(() => {
  for (const overview of created.splice(0)) overview.destroy();
  jest.useRealTimers();
});

describe('TabOverview button', () => {
  it('appears once a second tab exists and counts the open tabs', () => {
    const { overview } = setUp([item(1)]);

    overview.syncButton(1, 0);
    expect(overview.buttonEl.hasClass('claudian-hidden')).toBe(true);

    overview.syncButton(4, 0);
    expect(overview.buttonEl.hasClass('claudian-hidden')).toBe(false);
    expect(overview.buttonEl.querySelector('.claudian-tab-overview-btn-count')?.textContent).toBe('4');
    expect(overview.buttonEl.getAttribute('aria-label')).toBe('Offene Chats: 4');
  });

  it('says how many tabs wait for the user', () => {
    const { overview } = setUp([item(1)]);

    overview.syncButton(4, 2);

    expect(overview.buttonEl.hasClass('has-attention')).toBe(true);
    expect(overview.buttonEl.getAttribute('aria-label')).toBe('Offene Chats: 4, 2 warten auf dich');
  });
});

describe('TabOverview rows', () => {
  it('lists every tab with full title, model line, status and number', () => {
    const { overview, part, rowFor, rows, search } = setUp([
      item(1),
      item(2, { title: 'Firewall-Regeln für das CERTUSS-Portal freischalten', isStreaming: true, streamingSince: 100_000 - 83_000 }),
      item(3, { attention: 'input', providerId: 'codex', providerName: 'Codex', modelLabel: 'GPT-6 Sol' }),
    ]);
    const focus = jest.spyOn(search(), 'focus');

    overview.open();

    expect(rows()).toHaveLength(3);
    const second = rowFor('tab-2');
    expect(part(second, 'claudian-tab-overview-title').textContent).toBe('Firewall-Regeln für das CERTUSS-Portal freischalten');
    expect(part(second, 'claudian-tab-overview-model').textContent).toBe('Claude · Opus 4.7');
    expect(part(second, 'claudian-tab-overview-status-text').textContent).toBe('Arbeitet · 1:23');
    expect(part(second, 'claudian-tab-overview-key').textContent).toBe('2');
    expect(part(rowFor('tab-3'), 'claudian-tab-overview-status-text').textContent).toBe('Wartet auf dich');
    expect(rowFor('tab-3').getAttribute('data-provider')).toBe('codex');
    expect(focus).toHaveBeenCalled();
  });

  it('marks the active tab for sight and for screen readers', () => {
    const { overview, part, rowFor } = setUp([item(1), item(2)]);

    overview.open();

    expect(rowFor('tab-1').hasClass('is-active')).toBe(true);
    expect(part(rowFor('tab-1'), 'claudian-tab-overview-main').getAttribute('aria-current')).toBe('true');
    expect(part(rowFor('tab-2'), 'claudian-tab-overview-main').getAttribute('aria-current')).toBeNull();
  });

  it('shows context, todo progress and running subagents only when known', () => {
    const { overview, part, rowFor } = setUp([
      item(1),
      item(2, { contextPercent: 41.6, todos: { done: 3, total: 7 }, runningSubagents: 2 }),
    ]);

    overview.open();

    expect(part(rowFor('tab-1'), 'claudian-tab-overview-chip')).toBeNull();
    const meta = part(rowFor('tab-2'), 'claudian-tab-overview-meta');
    const chips = meta.querySelectorAll('.claudian-tab-overview-chip');
    expect(chips.map((chip: any) => chip.getAttribute('aria-label'))).toEqual([
      'Kontext zu 42 % belegt',
      'Aufgaben: 3 von 7 erledigt',
      '2 Subagenten laufen',
    ]);
  });

  it('offers no number hint beyond the ninth tab', () => {
    const items = Array.from({ length: 10 }, (_, index) => item(index + 1));
    const { overview, part, rowFor } = setUp(items);

    overview.open();

    expect(part(rowFor('tab-9'), 'claudian-tab-overview-key').hasClass('claudian-hidden')).toBe(false);
    expect(part(rowFor('tab-10'), 'claudian-tab-overview-key').hasClass('claudian-hidden')).toBe(true);
  });
});

describe('TabOverview live updates', () => {
  it('ticks the clock of a working tab in place instead of rebuilding its row', () => {
    jest.useFakeTimers();
    const { advancePerf, overview, part, rowFor } = setUp([
      item(1),
      item(2, { isStreaming: true, streamingSince: 100_000 - 5_000 }),
    ]);
    overview.open();
    const row = rowFor('tab-2');
    const main = part(row, 'claudian-tab-overview-main');

    advancePerf(2_000);
    jest.advanceTimersByTime(1_000);

    expect(rowFor('tab-2')).toBe(row);
    expect(part(row, 'claudian-tab-overview-main')).toBe(main);
    expect(part(row, 'claudian-tab-overview-status-text').textContent).toBe('Arbeitet · 0:07');
  });

  it('follows state changes on refresh and stops ticking once closed', () => {
    jest.useFakeTimers();
    const { callbacks, overview, part, rowFor, setItems } = setUp([item(1), item(2, { isStreaming: true, streamingSince: 1 })]);
    overview.open();

    setItems([item(1), item(2, { attention: 'finished' })]);
    overview.refresh();
    expect(part(rowFor('tab-2'), 'claudian-tab-overview-status-text').textContent).toBe('Neue Antwort · vor 3 Min.');
    expect(rowFor('tab-2').getAttribute('data-state')).toBe('finished');

    overview.close();
    callbacks.getItems.mockClear();
    jest.advanceTimersByTime(5_000);
    expect(callbacks.getItems).not.toHaveBeenCalled();
  });

  it('drops the row of a tab that was closed elsewhere', () => {
    const { overview, rows, setItems } = setUp([item(1), item(2), item(3)]);
    overview.open();

    setItems([item(1), item(3)]);
    overview.refresh();

    expect(rows().map((row: any) => row.getAttribute('data-tab-id'))).toEqual(['tab-1', 'tab-3']);
  });
});

describe('TabOverview filter', () => {
  it('filters as the user types and explains an empty result', () => {
    const { hostEl, overview, rows, search } = setUp([
      item(1, { title: 'Firewall CERTUSS' }),
      item(2, { title: 'Faxfehler Beuthel' }),
    ]);
    overview.open();

    search().value = 'fax';
    search().dispatchEvent('input');
    expect(rows().map((row: any) => row.getAttribute('data-tab-id'))).toEqual(['tab-2']);

    search().value = 'zzz';
    search().dispatchEvent('input');
    expect(rows()).toHaveLength(0);
    const empty = hostEl.querySelector('.claudian-tab-overview-empty');
    expect(empty?.hasClass('claudian-hidden')).toBe(false);
    expect(empty?.textContent).toBe('Kein Tab passt zu „zzz“');
  });

  it('opens the best match with Enter', () => {
    const { callbacks, overview, panel, search } = setUp([item(1, { title: 'Firewall' }), item(2, { title: 'Faxfehler' })]);
    overview.open();
    search().value = 'fax';
    search().dispatchEvent('input');

    panel().dispatchEvent(keydown(search(), 'Enter'));

    expect(callbacks.onSelect).toHaveBeenCalledWith('tab-2');
    expect(overview.isOpen()).toBe(false);
  });

  it('starts every opening with an empty filter', () => {
    const { overview, rows, search } = setUp([item(1, { title: 'Firewall' }), item(2, { title: 'Faxfehler' })]);
    overview.open();
    search().value = 'fax';
    search().dispatchEvent('input');
    overview.close();

    overview.open();

    expect(search().value).toBe('');
    expect(rows()).toHaveLength(2);
  });
});

describe('TabOverview keyboard and actions', () => {
  it('switches on click and closes', () => {
    const { callbacks, overview, part, rowFor } = setUp([item(1), item(2)]);
    overview.open();

    part(rowFor('tab-2'), 'claudian-tab-overview-main').click();

    expect(callbacks.onSelect).toHaveBeenCalledWith('tab-2');
    expect(overview.isOpen()).toBe(false);
  });

  it('moves through rows with the arrow keys and back into the search field', () => {
    const { overview, panel, part, rowFor, search } = setUp([item(1), item(2)]);
    overview.open();
    const firstMain = part(rowFor('tab-1'), 'claudian-tab-overview-main');
    const secondMain = part(rowFor('tab-2'), 'claudian-tab-overview-main');
    const focusFirst = jest.spyOn(firstMain, 'focus');
    const focusSecond = jest.spyOn(secondMain, 'focus');
    const focusSearch = jest.spyOn(search(), 'focus');

    panel().dispatchEvent(keydown(search(), 'ArrowDown'));
    panel().dispatchEvent(keydown(firstMain, 'ArrowDown'));
    panel().dispatchEvent(keydown(firstMain, 'ArrowUp'));

    expect(focusFirst).toHaveBeenCalled();
    expect(focusSecond).toHaveBeenCalled();
    expect(focusSearch).toHaveBeenCalled();
  });

  it('jumps straight to a tab with Cmd or Ctrl and its number', () => {
    const { callbacks, overview, panel, search } = setUp([item(1), item(2), item(3)]);
    overview.open();

    const event = keydown(search(), '3', { metaKey: true });
    panel().dispatchEvent(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(callbacks.onSelect).toHaveBeenCalledWith('tab-3');
  });

  // The view toggles plan mode on Shift+Tab from anywhere; inside the dialog
  // Tab and Shift+Tab must move focus instead.
  it('keeps Tab and Shift+Tab for focus movement inside the dialog', () => {
    const { overview, panel, search } = setUp([item(1), item(2)]);
    overview.open();

    const event = keydown(search(), 'Tab', { shiftKey: true });
    panel().dispatchEvent(event);

    expect(event.stopPropagation).toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(overview.isOpen()).toBe(true);
  });

  it('closes on Escape and hands focus back to where it came from', () => {
    const { overview, panel, search } = setUp([item(1), item(2)]);
    const focusButton = jest.spyOn(overview.buttonEl, 'focus');
    overview.open();

    const event = keydown(search(), 'Escape');
    panel().dispatchEvent(event);

    expect(overview.isOpen()).toBe(false);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(focusButton).toHaveBeenCalled();
  });

  it('closes an idle tab at once', () => {
    const { callbacks, overview, part, rowFor } = setUp([item(1), item(2)]);
    overview.open();

    part(rowFor('tab-2'), 'claudian-tab-overview-close').click();

    expect(callbacks.onClose).toHaveBeenCalledWith('tab-2');
  });

  it('asks inline before closing a tab that is still working', () => {
    const { callbacks, overview, part, rowFor } = setUp([item(1), item(2, { isStreaming: true, streamingSince: 1 })]);
    overview.open();
    const row = rowFor('tab-2');

    part(row, 'claudian-tab-overview-close').click();
    expect(callbacks.onClose).not.toHaveBeenCalled();
    expect(row.hasClass('is-confirming')).toBe(true);
    expect(part(row, 'claudian-tab-overview-confirm-text').textContent).toBe('Arbeitet noch – Antwort abbrechen?');

    part(row, 'claudian-tab-overview-confirm-keep').click();
    expect(row.hasClass('is-confirming')).toBe(false);
    expect(callbacks.onClose).not.toHaveBeenCalled();

    part(row, 'claudian-tab-overview-close').click();
    part(row, 'claudian-tab-overview-confirm-stop').click();
    expect(callbacks.onClose).toHaveBeenCalledWith('tab-2');
  });

  it('lets Escape back out of the close question without closing the overview', () => {
    const { overview, panel, part, rowFor } = setUp([item(1), item(2, { isStreaming: true, streamingSince: 1 })]);
    overview.open();
    const row = rowFor('tab-2');
    part(row, 'claudian-tab-overview-close').click();

    panel().dispatchEvent(keydown(part(row, 'claudian-tab-overview-confirm-stop'), 'Escape'));

    expect(row.hasClass('is-confirming')).toBe(false);
    expect(overview.isOpen()).toBe(true);
  });

  it('closes the focused row with Delete', () => {
    const { callbacks, overview, panel, part, rowFor } = setUp([item(1), item(2)]);
    overview.open();

    panel().dispatchEvent(keydown(part(rowFor('tab-2'), 'claudian-tab-overview-main'), 'Delete'));

    expect(callbacks.onClose).toHaveBeenCalledWith('tab-2');
  });

  it('opens a new tab from the footer, unless the limit is reached', () => {
    const open = setUp([item(1), item(2)]);
    open.overview.open();
    const newTab = open.hostEl.querySelector('.claudian-tab-overview-new')!;
    newTab.click();
    expect(open.callbacks.onNewTab).toHaveBeenCalled();
    expect(open.overview.isOpen()).toBe(false);

    const full = setUp([item(1), item(2)], { canCreateTab: false });
    full.overview.open();
    const blocked = full.hostEl.querySelector('.claudian-tab-overview-new')!;
    expect(blocked.disabled).toBe(true);
    expect(blocked.getAttribute('title')).toBe('Tab-Limit erreicht – in den Einstellungen erhöhen');
  });
});
