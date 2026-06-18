import {
  chooseModelRoute,
  inferRouterTask,
  normalizeRouterRules,
} from '@/core/routing/modelRouterRules';

describe('modelRouterRules', () => {
  it('infers common task kinds', () => {
    expect(inferRouterTask('fix this TypeScript bug')).toBe('code');
    expect(inferRouterTask('brainstorm a roadmap')).toBe('planning');
    expect(inferRouterTask('rewrite this email')).toBe('writing');
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
});
