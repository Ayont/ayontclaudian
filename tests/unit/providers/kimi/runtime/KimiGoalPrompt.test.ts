import { prepareKimiPromptWithGoal } from '@/providers/kimi/runtime/KimiGoalPrompt';

describe('prepareKimiPromptWithGoal', () => {
  it('sets a new goal from /goal <text>', () => {
    const result = prepareKimiPromptWithGoal('/goal explain Python', null);
    expect(result.nextGoal).toBe('explain Python');
    expect(result.promptToSend).toBe('/goal explain Python');
  });

  it('clears the goal from bare /goal', () => {
    const result = prepareKimiPromptWithGoal('/goal', 'old goal');
    expect(result.nextGoal).toBeNull();
    expect(result.promptToSend).toBe('/goal');
  });

  it('prepends an active goal to a normal prompt', () => {
    const result = prepareKimiPromptWithGoal('what is a list?', 'explain Python');
    expect(result.nextGoal).toBe('explain Python');
    expect(result.promptToSend).toBe('[Goal: explain Python]\n\nwhat is a list?');
  });

  it('passes a normal prompt through when no goal is active', () => {
    const result = prepareKimiPromptWithGoal('what is a list?', null);
    expect(result.nextGoal).toBeNull();
    expect(result.promptToSend).toBe('what is a list?');
  });

  it('ignores leading whitespace when detecting /goal', () => {
    const result = prepareKimiPromptWithGoal('  /goal review code  ', null);
    expect(result.nextGoal).toBe('review code');
  });
});
