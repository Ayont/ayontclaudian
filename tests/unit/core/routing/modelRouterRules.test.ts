import {
  AUTO_MODEL_VALUE,
  chooseModelRoute,
  inferRouterTask,
  normalizeRouterRules,
} from '@/core/routing/modelRouterRules';

describe('modelRouterRules', () => {
  it('infers common task kinds', () => {
    expect(inferRouterTask('fix this TypeScript bug')).toBe('code');
    expect(inferRouterTask('brainstorm a roadmap')).toBe('planning');
    expect(inferRouterTask('rewrite this email')).toBe('writing');
    expect(inferRouterTask('analyze this screenshot')).toBe('vision');
    expect(inferRouterTask('simple yes/no')).toBe('cheap');
  });

  it('normalizes and picks an available rule', () => {
    const rules = normalizeRouterRules([
      { task: 'code', model: 'kimi' },
      { task: 'writing', model: 'gpt' },
      { task: 'cheap', model: '' },
    ]);
    const route = chooseModelRoute({
      prompt: 'please refactor this code',
      rules,
      availableModels: [{ value: 'kimi', label: 'Kimi' } as any],
      fallbackModel: 'fallback',
    });
    expect(route).toMatchObject({ task: 'code', model: 'kimi' });
  });

  it('falls back when rule model is unavailable', () => {
    const route = chooseModelRoute({
      prompt: 'fix bug',
      rules: [{ task: 'code', model: 'missing' }],
      availableModels: [],
      fallbackModel: 'fallback',
    });
    expect(route.model).toBe('fallback');
  });

  it('routes vision prompts to a vision model', () => {
    const route = chooseModelRoute({
      prompt: 'review this UI screenshot',
      rules: [{ task: 'vision', model: 'gpt-vision' }],
      availableModels: [{ value: 'gpt-vision', label: 'GPT Vision' } as any],
      fallbackModel: 'fallback',
    });
    expect(route).toMatchObject({ task: 'vision', model: 'gpt-vision' });
  });

  it('routes cheap prompts to a cheap model', () => {
    const route = chooseModelRoute({
      prompt: 'simple yes/no answer',
      rules: [{ task: 'cheap', model: 'haiku' }],
      availableModels: [{ value: 'haiku', label: 'Haiku' } as any],
      fallbackModel: 'fallback',
    });
    expect(route).toMatchObject({ task: 'cheap', model: 'haiku' });
  });

  it('exposes an auto model sentinel value', () => {
    expect(AUTO_MODEL_VALUE).toBe('__auto__');
  });
});
