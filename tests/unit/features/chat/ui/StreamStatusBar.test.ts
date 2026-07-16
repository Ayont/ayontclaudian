import { createMockEl } from '@test/helpers/mockElement';

import {
  appendActivity,
  formatActivityOffset,
  formatElapsed,
  MAX_ACTIVITY_HISTORY,
  resolveActivityStage,
  type StreamActivity,
  StreamStatusBar,
} from '@/features/chat/ui/StreamStatusBar';

describe('resolveActivityStage', () => {
  it('maps provider-neutral live activity to the five visual phases', () => {
    expect(resolveActivityStage('Durchsuche Vault-Kontext')).toBe(0);
    expect(resolveActivityStage('Starte Provider-Runtime')).toBe(1);
    expect(resolveActivityStage('Lese Datei')).toBe(2);
    expect(resolveActivityStage('Streame Antwort')).toBe(3);
    expect(resolveActivityStage('Sichere Unterhaltung')).toBe(4);
  });
});

describe('formatElapsed', () => {
  it('shows seconds under a minute', () => {
    expect(formatElapsed(0)).toBe('0s');
    expect(formatElapsed(1500)).toBe('1s');
    expect(formatElapsed(59_000)).toBe('59s');
  });

  it('shows M:SS at and beyond a minute', () => {
    expect(formatElapsed(60_000)).toBe('1:00');
    expect(formatElapsed(75_000)).toBe('1:15');
    expect(formatElapsed(605_000)).toBe('10:05');
  });

  it('clamps negative input to 0s', () => {
    expect(formatElapsed(-1000)).toBe('0s');
  });
});

describe('appendActivity', () => {
  const activity = (primary: string, meta = '', at = 0): StreamActivity => ({ primary, meta, at });

  it('keeps distinct provider transitions in chronological order', () => {
    const activities = appendActivity(
      appendActivity([], activity('Model is reasoning', 'Thinking stream', 10)),
      activity('Read file', 'CLAUDE.md', 20),
    );

    expect(activities).toEqual([
      activity('Model is reasoning', 'Thinking stream', 10),
      activity('Read file', 'CLAUDE.md', 20),
    ]);
  });

  it('deduplicates repetitive streaming events', () => {
    const first = appendActivity([], activity('Writing response', 'Assistant text stream', 10));
    const next = appendActivity(first, activity('Writing response', 'Assistant text stream', 20));

    expect(next).toEqual([activity('Writing response', 'Assistant text stream', 10)]);
  });

  it('keeps the newest activities within the requested bound', () => {
    const activities = ['one', 'two', 'three'].reduce(
      (history, primary, index) => appendActivity(history, activity(primary, '', index), 2),
      [] as StreamActivity[],
    );

    expect(activities.map(entry => entry.primary)).toEqual(['two', 'three']);
  });
});

describe('formatActivityOffset', () => {
  it('shows one decimal below 10 seconds (preflight bursts are sub-second)', () => {
    // Regression: second-granularity rendered every preflight step as `+0s`,
    // which read as a broken timer instead of a fast preflight.
    expect(formatActivityOffset(1000, 1000)).toBe('+0.0s');
    expect(formatActivityOffset(1000, 1400)).toBe('+0.4s');
    expect(formatActivityOffset(1000, 3600)).toBe('+2.6s');
    expect(formatActivityOffset(1000, 10_900)).toBe('+9.9s');
  });

  it('switches to whole seconds and M:SS beyond 10 seconds', () => {
    expect(formatActivityOffset(0, 12_000)).toBe('+12s');
    expect(formatActivityOffset(0, 75_000)).toBe('+1:15');
  });

  it('clamps negative offsets', () => {
    expect(formatActivityOffset(5000, 1000)).toBe('+0.0s');
  });
});

describe('StreamStatusBar DOM updates', () => {
  function createBar(): { parent: any; bar: StreamStatusBar } {
    const parent = createMockEl();
    const bar = new StreamStatusBar(parent, { now: () => 1000 });
    return { parent, bar };
  }

  it('performs no DOM writes when the same activity repeats per stream chunk', () => {
    const { parent, bar } = createBar();
    bar.setActivity('Schreibe Antwort', 'Antwort-Stream');

    const historyEl = parent.querySelector('.claudian-stream-status-history');
    const activityEl = parent.querySelector('.claudian-stream-status-activity');
    const detailPrimaryEl = parent.querySelector('.claudian-stream-status-detail-primary');
    const detailMetaEl = parent.querySelector('.claudian-stream-status-detail-meta');
    const toggleEl = parent.querySelector('.claudian-stream-status-toggle');
    const eventCountEl = parent.querySelector('.claudian-stream-status-event-count');
    const spies = [
      jest.spyOn(historyEl, 'empty'),
      jest.spyOn(historyEl, 'createDiv'),
      jest.spyOn(historyEl, 'createEl'),
      jest.spyOn(activityEl, 'setText'),
      jest.spyOn(detailPrimaryEl, 'setText'),
      jest.spyOn(detailMetaEl, 'setText'),
      jest.spyOn(toggleEl, 'setAttribute'),
      jest.spyOn(eventCountEl, 'setAttribute'),
    ];

    for (let chunk = 0; chunk < 50; chunk++) {
      bar.setActivity('Schreibe Antwort', 'Antwort-Stream');
    }

    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });

  it('updates the DOM when the activity changes', () => {
    const { parent, bar } = createBar();
    bar.setActivity('Schreibe Antwort', 'Antwort-Stream');

    const historyEl = parent.querySelector('.claudian-stream-status-history');
    const emptySpy = jest.spyOn(historyEl, 'empty');

    bar.setActivity('Lese Datei', 'README.md');

    expect(emptySpy).toHaveBeenCalledTimes(1);
    expect(parent.querySelectorAll('.claudian-stream-status-history-item')).toHaveLength(2);
    expect(parent.querySelector('.claudian-stream-status-activity').textContent).toBe('Lese Datei');
    expect(parent.querySelector('.claudian-stream-status-toggle').getAttribute('aria-label'))
      .toBe('Live-Aktivität anzeigen: Lese Datei');
  });

  it('still rebuilds the history at the cap when a new activity arrives', () => {
    const { parent, bar } = createBar();
    for (let step = 0; step < MAX_ACTIVITY_HISTORY; step++) {
      bar.setActivity(`Schritt ${step}`, `meta ${step}`);
    }

    const historyEl = parent.querySelector('.claudian-stream-status-history');
    const emptySpy = jest.spyOn(historyEl, 'empty');

    bar.setActivity('Schritt neu', 'meta neu');

    // The list stays at the cap, so a length-only check would miss this append.
    expect(emptySpy).toHaveBeenCalledTimes(1);
    expect(parent.querySelectorAll('.claudian-stream-status-history-item'))
      .toHaveLength(MAX_ACTIVITY_HISTORY);
  });

  it('does not rebuild the history when only the label changes', () => {
    const { parent, bar } = createBar();
    bar.setActivity('Lese Datei', 'README.md');

    const historyEl = parent.querySelector('.claudian-stream-status-history');
    const emptySpy = jest.spyOn(historyEl, 'empty');

    bar.setLabel('Claude');

    expect(emptySpy).not.toHaveBeenCalled();
    expect(parent.querySelector('.claudian-stream-status-detail-meta').textContent)
      .toBe('Claude · arbeitet · README.md');
  });

  it('performs no DOM writes when the same phrase repeats', () => {
    const { parent, bar } = createBar();
    bar.setPhrase('writing');

    const phraseEl = parent.querySelector('.claudian-stream-status-phrase');
    const detailMetaEl = parent.querySelector('.claudian-stream-status-detail-meta');
    const historyEl = parent.querySelector('.claudian-stream-status-history');
    const spies = [
      jest.spyOn(phraseEl, 'setText'),
      jest.spyOn(detailMetaEl, 'setText'),
      jest.spyOn(historyEl, 'empty'),
    ];

    bar.setPhrase('writing');

    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });

  it('updates the phrase when it changes', () => {
    const { parent, bar } = createBar();
    bar.setPhrase('writing');
    bar.setPhrase('reasoning');

    expect(parent.querySelector('.claudian-stream-status-phrase').textContent).toBe('reasoning');
    expect(parent.querySelector('.claudian-stream-status-detail-meta').textContent)
      .toContain('reasoning');
  });
});
