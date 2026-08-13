import {
  CLINE_PASS_MODELS,
  DEFAULT_CLINE_CONTEXT_WINDOW,
  DEFAULT_CLINE_PRIMARY_MODEL,
  getClineModelContextWindow,
  getClineModelMeta,
  isClinePassModel,
  resolveClineApiProvider,
} from '@/providers/cline/types/models';

describe('ClinePass catalog', () => {
  it('includes every official ClinePass model id', () => {
    const ids = CLINE_PASS_MODELS.map((model) => model.id);
    expect(ids).toEqual(expect.arrayContaining([
      'cline-pass/glm-5.2',
      'cline-pass/kimi-k3',
      'cline-pass/kimi-k2.7-code',
      'cline-pass/kimi-k2.6',
      'cline-pass/deepseek-v4-pro',
      'cline-pass/deepseek-v4-flash',
      'cline-pass/mimo-v2.5',
      'cline-pass/mimo-v2.5-pro',
      'cline-pass/minimax-m3',
      'cline-pass/qwen3.8-max',
      'cline-pass/qwen3.7-max',
      'cline-pass/qwen3.7-plus',
    ]));
    expect(DEFAULT_CLINE_PRIMARY_MODEL).toBe('cline-pass/kimi-k3');
  });

  it('uses the published per-model context windows from @cline/llms', () => {
    expect(getClineModelContextWindow('cline-pass/kimi-k3')).toBe(1_048_576);
    expect(getClineModelContextWindow('cline-pass/kimi-k2.7-code')).toBe(262_144);
    expect(getClineModelContextWindow('cline-pass/deepseek-v4-flash')).toBe(1_048_576);
    expect(getClineModelContextWindow('cline-pass/qwen3.8-max')).toBe(1_000_000);
    expect(getClineModelContextWindow('unknown-model')).toBe(DEFAULT_CLINE_CONTEXT_WINDOW);
  });

  it('routes namespaced models to the matching Cline API provider', () => {
    expect(resolveClineApiProvider('cline-pass/glm-5.2')).toBe('cline-pass');
    expect(resolveClineApiProvider('cline/anthropic/claude-sonnet-4.6')).toBe('cline');
    expect(resolveClineApiProvider('anthropic/claude-sonnet-4.6', 'anthropic')).toBe('anthropic');
    expect(isClinePassModel('cline-pass/minimax-m3')).toBe(true);
    expect(getClineModelMeta('cline-pass/kimi-k3')?.supportsImages).toBe(true);
  });
});
