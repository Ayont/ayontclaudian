import { applyGoalPrefix, parseGoalArgs } from '@/core/conversation/goalPrompt';

describe('parseGoalArgs', () => {
  it('returns trimmed text as the goal', () => {
    expect(parseGoalArgs('  ship the release  ')).toBe('ship the release');
  });

  it('returns null for empty/whitespace (clear)', () => {
    expect(parseGoalArgs('')).toBeNull();
    expect(parseGoalArgs('   ')).toBeNull();
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
