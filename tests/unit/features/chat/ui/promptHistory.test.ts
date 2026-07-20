import { extractRecallablePrompts, PromptHistoryCursor } from '@/features/chat/ui/promptHistory';

const message = (content: string, overrides: Record<string, unknown> = {}) => ({
  role: 'user',
  content,
  ...overrides,
});

describe('extractRecallablePrompts', () => {
  it('keeps user prompts oldest→newest and prefers displayContent', () => {
    const prompts = extractRecallablePrompts([
      message('expanded /tests prompt', { displayContent: '/tests' }),
      { role: 'assistant', content: 'Antwort' },
      message('Zweiter Prompt'),
    ]);
    expect(prompts).toEqual(['/tests', 'Zweiter Prompt']);
  });

  it('skips interrupts, rebuilt context, empty prompts and collapses duplicates', () => {
    const prompts = extractRecallablePrompts([
      message('A'),
      message('A'),
      message('', {}),
      message('Interrupt', { isInterrupt: true }),
      message('Rebuilt', { isRebuiltContext: true }),
      message('B'),
    ]);
    expect(prompts).toEqual(['A', 'B']);
  });
});

describe('PromptHistoryCursor', () => {
  const cursor = () => new PromptHistoryCursor(() => ['eins', 'zwei', 'drei']);

  it('starts browsing only on an empty composer', () => {
    const c = cursor();
    expect(c.older('Entwurf')).toBeNull();
    expect(c.isBrowsing()).toBe(false);
    expect(c.older('  ')).toBe('drei');
    expect(c.isBrowsing()).toBe(true);
  });

  it('cycles older until the oldest and sticks there', () => {
    const c = cursor();
    expect(c.older('')).toBe('drei');
    expect(c.older('drei')).toBe('zwei');
    expect(c.older('zwei')).toBe('eins');
    expect(c.older('eins')).toBe('eins');
  });

  it('cycles newer back to the empty draft and exits browsing', () => {
    const c = cursor();
    c.older('');
    c.older('drei');
    expect(c.newer()).toBe('drei');
    expect(c.newer()).toBe('');
    expect(c.isBrowsing()).toBe(false);
    expect(c.newer()).toBeNull();
  });

  it('typing resets browsing, cursor-set values do not', () => {
    const c = cursor();
    c.older('');
    c.notifyInput('drei'); // value the cursor set itself → keep browsing
    expect(c.isBrowsing()).toBe(true);
    c.notifyInput('drei bearbeitet'); // user typed → exit
    expect(c.isBrowsing()).toBe(false);
  });

  it('returns null without history', () => {
    const empty = new PromptHistoryCursor(() => []);
    expect(empty.older('')).toBeNull();
  });
});
