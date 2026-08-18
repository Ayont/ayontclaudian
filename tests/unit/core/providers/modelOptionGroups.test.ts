import { groupModelOptions, parseModelEffort } from '@/core/providers/modelOptionGroups';
import type { ProviderUIOption } from '@/core/providers/types';

describe('parseModelEffort', () => {
  it('splits Gemini High/Low/Medium suffixes from the family name', () => {
    expect(parseModelEffort('Gemini 3.7 Flash (High)', 'Antigravity · Gemini 3.7 Flash (High)')).toEqual({
      family: 'Gemini 3.7 Flash',
      level: 'high',
      effortLabel: 'High',
    });
    expect(parseModelEffort('Gemini 3.1 Pro (Low)', 'Gemini 3.1 Pro (Low)')).toMatchObject({
      family: 'Gemini 3.1 Pro',
      level: 'low',
    });
    expect(parseModelEffort('Claude Sonnet 4.6 (Thinking)', 'Claude Sonnet 4.6 (Thinking)')).toMatchObject({
      family: 'Claude Sonnet 4.6',
      level: 'thinking',
    });
  });

  it('leaves models without an effort suffix ungrouped', () => {
    expect(parseModelEffort('Opus 1M', 'Opus 1M')).toEqual({
      family: 'Opus 1M',
      level: null,
      effortLabel: null,
    });
  });
});

describe('groupModelOptions', () => {
  const gemini = (suffix: 'Low' | 'Medium' | 'High'): ProviderUIOption => ({
    value: `Gemini 3.7 Flash (${suffix})`,
    label: `Antigravity · Gemini 3.7 Flash (${suffix})`,
    group: 'ANTIGRAVITY',
    providerId: 'antigravity',
  });

  it('collapses High/Low/Medium into one family with selectable variants', () => {
    const grouped = groupModelOptions([gemini('Low'), gemini('Medium'), gemini('High')]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].familyLabel).toBe('Gemini 3.7 Flash');
    expect(grouped[0].variants.map((variant) => variant.level)).toEqual(['low', 'medium', 'high']);
    expect(grouped[0].primaryValue).toBe('Gemini 3.7 Flash (High)');
  });

  it('keeps unrelated models as their own rows', () => {
    const grouped = groupModelOptions([
      { value: 'Opus 1M', label: 'Opus 1M', group: 'CLAUDE', providerId: 'claude' },
      gemini('High'),
      gemini('Low'),
    ]);
    expect(grouped.map((item) => item.familyLabel)).toEqual(['Opus 1M', 'Gemini 3.7 Flash']);
    expect(grouped[0].variants).toHaveLength(0);
    expect(grouped[1].variants).toHaveLength(2);
  });
});
