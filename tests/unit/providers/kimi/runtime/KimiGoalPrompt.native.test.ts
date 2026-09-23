import {
  buildKimiGoalCreatePrompt,
  kimiGoalStatusForExit,
  parseKimiGoalCreate,
} from '@/providers/kimi/runtime/KimiGoalPrompt';

describe('Kimi headless goals', () => {
  it('reads the objective of a goal-create prompt', () => {
    expect(parseKimiGoalCreate('/goal Alle Tests grün')).toBe('Alle Tests grün');
    expect(parseKimiGoalCreate('/goal replace Neues Ziel')).toBe('Neues Ziel');
    expect(parseKimiGoalCreate('/goal -- pause the music')).toBe('pause the music');
  });

  it('treats goal subcommands and plain prompts as no goal creation', () => {
    expect(parseKimiGoalCreate('/goal pause')).toBeNull();
    expect(parseKimiGoalCreate('/goal')).toBeNull();
    expect(parseKimiGoalCreate('Bitte /goal lesen')).toBeNull();
  });

  it('replaces an existing goal instead of failing to create a second one', () => {
    expect(buildKimiGoalCreatePrompt('Ziel', false)).toBe('/goal Ziel');
    expect(buildKimiGoalCreatePrompt('Ziel', true)).toBe('/goal replace Ziel');
  });

  it('maps the goal exit codes of kimi-code', () => {
    expect(kimiGoalStatusForExit(0)).toBe('complete');
    expect(kimiGoalStatusForExit(3)).toBe('blocked');
    expect(kimiGoalStatusForExit(6)).toBe('paused');
    expect(kimiGoalStatusForExit(1)).toBeNull();
    expect(kimiGoalStatusForExit(null)).toBeNull();
  });
});
