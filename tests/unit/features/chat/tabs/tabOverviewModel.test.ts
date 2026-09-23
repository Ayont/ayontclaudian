import {
  composeModelLine,
  describeTabBadgeStatus,
  describeTabStatus,
  displayTabTitle,
  filterTabOverviewItems,
  formatElapsedClock,
  formatRelativeAgo,
  isGenericTabTitle,
  summarizeTabOverview,
  type TabOverviewItem,
  tabOverviewRowSignature,
} from '@/features/chat/tabs/tabOverviewModel';

const MINUTE = 60_000;
const NOW = Date.UTC(2026, 8, 23, 14, 0, 0);

function item(overrides: Partial<TabOverviewItem> = {}): TabOverviewItem {
  return {
    id: 'tab-1',
    index: 1,
    title: 'Firewall-Regeln CERTUSS',
    providerId: 'claude',
    providerName: 'Claude',
    modelLabel: 'Opus 4.7',
    isActive: false,
    isStreaming: false,
    streamingSince: null,
    attention: null,
    hasDraft: false,
    lastActivityAt: NOW - 3 * MINUTE,
    contextPercent: null,
    todos: null,
    runningSubagents: 0,
    canClose: true,
    isEmpty: false,
    ...overrides,
  };
}

const clock = { now: NOW, perfNow: 500_000 };

describe('formatElapsedClock', () => {
  it('reads as m:ss and grows an hour field only when needed', () => {
    expect(formatElapsedClock(0)).toBe('0:00');
    expect(formatElapsedClock(83_000)).toBe('1:23');
    expect(formatElapsedClock(3_725_000)).toBe('1:02:05');
    expect(formatElapsedClock(-5)).toBe('0:00');
  });
});

describe('formatRelativeAgo', () => {
  it('uses short German relative phrases', () => {
    expect(formatRelativeAgo(NOW - 10_000, NOW)).toBe('gerade eben');
    expect(formatRelativeAgo(NOW - 3 * MINUTE, NOW)).toBe('vor 3 Min.');
    expect(formatRelativeAgo(NOW - 2 * 60 * MINUTE, NOW)).toBe('vor 2 Std.');
    expect(formatRelativeAgo(NOW - 24 * 60 * MINUTE, NOW)).toBe('vor 1 Tag');
    expect(formatRelativeAgo(NOW - 3 * 24 * 60 * MINUTE, NOW)).toBe('vor 3 Tagen');
    expect(formatRelativeAgo(Date.UTC(2026, 8, 2, 12), NOW)).toBe('am 2.9.');
  });
});

describe('describeTabStatus', () => {
  it('shows a live clock while the tab works', () => {
    const status = describeTabStatus(item({ isStreaming: true, streamingSince: 500_000 - 83_000 }), clock);
    expect(status).toEqual({ kind: 'streaming', label: 'Arbeitet · 1:23' });
  });

  it('puts a blocking prompt ahead of the running clock', () => {
    const status = describeTabStatus(item({ isStreaming: true, streamingSince: 1, attention: 'input' }), clock);
    expect(status).toEqual({ kind: 'input', label: 'Wartet auf dich' });
  });

  it('marks unread and failed answers with their age', () => {
    expect(describeTabStatus(item({ attention: 'finished' }), clock))
      .toEqual({ kind: 'finished', label: 'Neue Antwort · vor 3 Min.' });
    expect(describeTabStatus(item({ attention: 'failed' }), clock))
      .toEqual({ kind: 'failed', label: 'Fehlgeschlagen · vor 3 Min.' });
  });

  it('prefers the draft over the age of the last answer', () => {
    expect(describeTabStatus(item({ hasDraft: true }), clock)).toEqual({ kind: 'draft', label: 'Entwurf' });
  });

  it('reports a finished chat by its age', () => {
    expect(describeTabStatus(item(), clock)).toEqual({ kind: 'idle', label: 'Fertig vor 3 Min.' });
    expect(describeTabStatus(item({ lastActivityAt: NOW - 5_000 }), clock))
      .toEqual({ kind: 'idle', label: 'Fertig gerade eben' });
  });

  it('calls an unused tab empty', () => {
    expect(describeTabStatus(item({ isEmpty: true, lastActivityAt: null }), clock))
      .toEqual({ kind: 'empty', label: 'Noch leer' });
  });
});

describe('describeTabBadgeStatus', () => {
  it('uses the short form without clocks for tooltips', () => {
    expect(describeTabBadgeStatus({ isStreaming: true, attention: null, hasDraft: false })).toBe('Arbeitet');
    expect(describeTabBadgeStatus({ isStreaming: true, attention: 'input', hasDraft: false })).toBe('Wartet auf dich');
    expect(describeTabBadgeStatus({ isStreaming: false, attention: 'finished', hasDraft: true })).toBe('Neue Antwort');
    expect(describeTabBadgeStatus({ isStreaming: false, attention: null, hasDraft: true })).toBe('Entwurf');
    expect(describeTabBadgeStatus({ isStreaming: false, attention: null, hasDraft: false })).toBeNull();
  });
});

describe('titles', () => {
  it('treats placeholder titles as generic and shows them in German', () => {
    expect(isGenericTabTitle('New Chat')).toBe(true);
    expect(isGenericTabTitle('neuer chat')).toBe(true);
    expect(isGenericTabTitle('Chat 4')).toBe(true);
    expect(isGenericTabTitle('Newsletter planen')).toBe(false);
    expect(displayTabTitle('New Chat')).toBe('Neuer Chat');
    expect(displayTabTitle('  Angebot GF Partners ')).toBe('Angebot GF Partners');
  });
});

describe('composeModelLine', () => {
  it('pairs the provider name with the model without repeating it', () => {
    expect(composeModelLine('Claude', 'Opus 4.7')).toBe('Claude · Opus 4.7');
    expect(composeModelLine('Kimi', 'Kimi · K2.7 Code')).toBe('Kimi · K2.7 Code');
    expect(composeModelLine('Grok', 'Grok')).toBe('Grok');
    expect(composeModelLine('Codex', null)).toBe('Codex');
  });
});

describe('filterTabOverviewItems', () => {
  const items = [
    item({ id: 'a', index: 1, title: 'Firewall-Regeln CERTUSS' }),
    item({ id: 'b', index: 2, title: 'Faxfehler Beuthel', providerId: 'codex', providerName: 'Codex', modelLabel: 'GPT-6 Sol' }),
    item({ id: 'c', index: 3, title: 'Galerie mit Lightbox', isStreaming: true, streamingSince: 1 }),
  ];

  it('keeps tab order and returns everything for an empty query', () => {
    expect(filterTabOverviewItems(items, '  ', clock).map((entry) => entry.id)).toEqual(['a', 'b', 'c']);
  });

  it('matches title, provider, model and status, every word, ignoring case and accents', () => {
    expect(filterTabOverviewItems(items, 'codex fax', clock).map((entry) => entry.id)).toEqual(['b']);
    expect(filterTabOverviewItems(items, 'sol', clock).map((entry) => entry.id)).toEqual(['b']);
    expect(filterTabOverviewItems(items, 'arbeitet', clock).map((entry) => entry.id)).toEqual(['c']);
    expect(filterTabOverviewItems(items, 'regeln certuss', clock).map((entry) => entry.id)).toEqual(['a']);
    expect(filterTabOverviewItems(items, 'galérie', clock).map((entry) => entry.id)).toEqual(['c']);
    expect(filterTabOverviewItems(items, 'nichts', clock)).toEqual([]);
  });
});

describe('summarizeTabOverview', () => {
  it('counts working and waiting tabs with singular and plural forms', () => {
    expect(summarizeTabOverview([item()])).toBe('1 Tab');
    expect(summarizeTabOverview([
      item({ isStreaming: true }),
      item({ attention: 'finished' }),
      item({ attention: 'input', isStreaming: true }),
      item(),
    ])).toBe('4 Tabs · 1 arbeitet · 2 warten auf dich');
  });
});

describe('tabOverviewRowSignature', () => {
  it('ignores the clock so a running tab is not rebuilt every second', () => {
    const running = item({ isStreaming: true, streamingSince: 1 });
    expect(tabOverviewRowSignature(running)).toBe(tabOverviewRowSignature({ ...running }));
    expect(tabOverviewRowSignature(running)).not.toBe(tabOverviewRowSignature({ ...running, contextPercent: 42 }));
  });
});
