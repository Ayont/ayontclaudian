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

  it('parses extended effort levels (XHigh, Max, Minimal, Off)', () => {
    expect(parseModelEffort('GPT-5.5 (XHigh)', 'GPT-5.5 (XHigh)')).toEqual({
      family: 'GPT-5.5',
      level: 'xhigh',
      effortLabel: 'XHigh',
    });
    expect(parseModelEffort('Claude Opus 5 (Max)', 'Claude Opus 5 (Max)')).toEqual({
      family: 'Claude Opus 5',
      level: 'max',
      effortLabel: 'Max',
    });
    expect(parseModelEffort('Pi Reasoning (Minimal)', 'Pi Reasoning (Minimal)')).toEqual({
      family: 'Pi Reasoning',
      level: 'minimal',
      effortLabel: 'Minimal',
    });
    expect(parseModelEffort('Opencode Fast (Off)', 'Opencode Fast (Off)')).toEqual({
      family: 'Opencode Fast',
      level: 'off',
      effortLabel: 'Off',
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

  it('collapses extended variants (Medium, High, XHigh, Max)', () => {
    const codex = (suffix: string): ProviderUIOption => ({
      value: `GPT-5.5 (${suffix})`,
      label: `Codex · GPT-5.5 (${suffix})`,
      group: 'CODEX',
      providerId: 'codex',
    });
    const grouped = groupModelOptions([
      codex('High'),
      codex('Medium'),
      codex('XHigh'),
      codex('Max'),
    ]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].familyLabel).toBe('GPT-5.5');
    expect(grouped[0].variants.map((variant) => variant.level)).toEqual(['medium', 'high', 'xhigh', 'max']);
    expect(grouped[0].primaryValue).toBe('GPT-5.5 (High)');
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
