import { applyGoalPrefix, parseGoalArgs, stripGoalBlocks } from '@/core/conversation/goalPrompt';

describe('parseGoalArgs', () => {
  it('returns trimmed text as the goal', () => {
    expect(parseGoalArgs('  ship the release  ')).toBe('ship the release');
  });

  it('returns null for empty/whitespace (clear)', () => {
    expect(parseGoalArgs('')).toBeNull();
    expect(parseGoalArgs('   ')).toBeNull();
  });

  it('treats clear keywords as a clear (case-insensitive)', () => {
    for (const kw of ['done', 'clear', 'Done', 'FERTIG', 'erledigt', 'reset']) {
      expect(parseGoalArgs(kw)).toBeNull();
    }
  });

  it('keeps multi-word text that merely contains a keyword', () => {
    expect(parseGoalArgs('done with the migration')).toBe('done with the migration');
  });
});

describe('stripGoalBlocks', () => {
  it('removes a framed goal block and trims leading space', () => {
    const text = '<standing_goal>\nfinish v2\n</standing_goal>\n\nUser: hi';
    expect(stripGoalBlocks(text)).toBe('User: hi');
  });

  it('removes multiple blocks', () => {
    const text = '<standing_goal>\na\n</standing_goal>\n\nmid <standing_goal>\nb\n</standing_goal>\n\nend';
    expect(stripGoalBlocks(text)).toBe('mid end');
  });

  it('returns text unchanged when there is no block', () => {
    expect(stripGoalBlocks('plain text')).toBe('plain text');
  });
});

describe('applyGoalPrefix', () => {
  it('prepends a framed standing-goal block to the prompt', () => {
    const out = applyGoalPrefix('do the thing', 'finish v2');
    expect(out).toBe('<standing_goal>\nfinish v2\n</standing_goal>\n\ndo the thing');
  });

  it('returns the prompt unchanged when there is no goal', () => {
    expect(applyGoalPrefix('do the thing', null)).toBe('do the thing');
    expect(applyGoalPrefix('do the thing', '')).toBe('do the thing');
    expect(applyGoalPrefix('do the thing', '   ')).toBe('do the thing');
  });

  it('does not double-wrap an already-framed prompt', () => {
    const once = applyGoalPrefix('hi', 'goal');
    const twice = applyGoalPrefix(once, 'goal');
    expect(twice).toBe(once);
  });

  it('handles an empty prompt by emitting just the goal block', () => {
    expect(applyGoalPrefix('', 'goal')).toBe('<standing_goal>\ngoal\n</standing_goal>');
  });
});
