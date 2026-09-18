import {
  HISTORY_WINDOW_STEP,
  INITIAL_HISTORY_WINDOW,
  planMessageHistoryWindow,
} from '@/features/chat/rendering/messageHistoryWindow';

/**
 * Opening a long conversation used to mount every stored message in one
 * synchronous loop. A 3 MB archive with ~200 tool blocks froze the renderer for
 * so long that the chat pane never became visible at all — Obsidian reveals a
 * leaf only after the view's onOpen resolves.
 *
 * The chat scrolls to the bottom anyway, so the older messages cost everything
 * and buy nothing until the user asks for them.
 */
describe('planMessageHistoryWindow', () => {
  const messages = (count: number): string[] =>
    Array.from({ length: count }, (_, index) => `m${index}`);

  it('mounts a short conversation completely', () => {
    const plan = planMessageHistoryWindow(messages(12));

    expect(plan.visible).toHaveLength(12);
    expect(plan.hidden).toBe(0);
  });

  it('mounts only the newest messages of a long conversation', () => {
    const plan = planMessageHistoryWindow(messages(138));

    expect(plan.visible).toHaveLength(INITIAL_HISTORY_WINDOW);
    expect(plan.hidden).toBe(138 - INITIAL_HISTORY_WINDOW);
  });

  it('keeps the newest messages, not the oldest — the view is scrolled to the bottom', () => {
    const plan = planMessageHistoryWindow(messages(100), 3);

    expect(plan.visible).toEqual(['m97', 'm98', 'm99']);
  });

  it('exposes exactly how many older messages are still withheld', () => {
    const plan = planMessageHistoryWindow(messages(100), 30);

    expect(plan.hidden).toBe(70);
  });

  it('widens by one step so "load older" converges instead of re-rendering everything', () => {
    const first = planMessageHistoryWindow(messages(100), INITIAL_HISTORY_WINDOW);
    const second = planMessageHistoryWindow(
      messages(100),
      INITIAL_HISTORY_WINDOW + HISTORY_WINDOW_STEP,
    );

    expect(second.visible.length - first.visible.length).toBe(HISTORY_WINDOW_STEP);
    expect(second.hidden).toBeLessThan(first.hidden);
  });

  it('treats a non-positive limit as "no window" rather than rendering nothing', () => {
    const plan = planMessageHistoryWindow(messages(40), 0);

    expect(plan.visible).toHaveLength(40);
    expect(plan.hidden).toBe(0);
  });

  it('never reports hidden messages it did not withhold', () => {
    const plan = planMessageHistoryWindow(messages(5), 30);

    expect(plan.visible).toHaveLength(5);
    expect(plan.hidden).toBe(0);
  });
});
