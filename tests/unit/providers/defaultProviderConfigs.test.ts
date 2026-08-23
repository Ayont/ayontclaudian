import { getBuiltInProviderDefaultConfigs } from '@/providers/defaultProviderConfigs';

describe('getBuiltInProviderDefaultConfigs', () => {
  it('returns fresh built-in provider config objects', () => {
    const first = getBuiltInProviderDefaultConfigs();
    const second = getBuiltInProviderDefaultConfigs();

    expect(first).toHaveProperty('claude');
    expect(first).toHaveProperty('cline');
    expect(first).toHaveProperty('codex');
    expect(first).toHaveProperty('opencode');
    expect(first).toHaveProperty('pi');
    expect(first).toHaveProperty('hermes');
    expect(first).not.toBe(second);
    expect(first.hermes).not.toBe(second.hermes);
    expect(first.claude).not.toBe(second.claude);
    expect(first.codex).not.toBe(second.codex);
    expect(first.opencode).not.toBe(second.opencode);
    expect(first.pi).not.toBe(second.pi);
  });
});
