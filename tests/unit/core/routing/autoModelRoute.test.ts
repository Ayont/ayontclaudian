import type { ProviderUIOption } from '@/core/providers/types';
import { chooseBestAutoModel, inferAutoComplexity } from '@/core/routing/autoModelRoute';

const models: ProviderUIOption[] = [
  { value: 'haiku', label: 'Haiku', providerId: 'claude' },
  { value: 'Gemini 3.7 Flash (Low)', label: 'Gemini 3.7 Flash (Low)', providerId: 'antigravity' },
  { value: 'Gemini 3.7 Flash (High)', label: 'Gemini 3.7 Flash (High)', providerId: 'antigravity' },
  { value: 'claude-sonnet-4-5', label: 'Sonnet', providerId: 'claude' },
  { value: 'claude-opus-4-6', label: 'Opus', providerId: 'claude' },
  { value: 'kimi-code/kimi-for-coding', label: 'Kimi Coding', providerId: 'kimi' },
];

describe('inferAutoComplexity', () => {
  it('treats greetings and tiny asks as trivial', () => {
    expect(inferAutoComplexity('danke')).toBe('trivial');
    expect(inferAutoComplexity('ok')).toBe('trivial');
  });

  it('treats architecture and long prompts as hard', () => {
    expect(inferAutoComplexity('entwirf die gesamte Architektur für das Multi-Agent-System')).toBe('hard');
    expect(inferAutoComplexity('x'.repeat(900))).toBe('hard');
  });
});

describe('chooseBestAutoModel', () => {
  it('picks a cheap or low-effort model for trivial prompts', () => {
    const route = chooseBestAutoModel({
      prompt: 'danke',
      availableModels: models,
      fallbackModel: 'claude-sonnet-4-5',
    });
    expect(['haiku', 'Gemini 3.7 Flash (Low)']).toContain(route.model);
    expect(route.task).toBe('cheap');
  });

  it('picks a coding model for a refactor request', () => {
    const route = chooseBestAutoModel({
      prompt: 'refactore diese TypeScript Funktion und schreibe Tests',
      availableModels: models,
      fallbackModel: 'haiku',
    });
    expect(route.model).toBe('kimi-code/kimi-for-coding');
    expect(route.task).toBe('code');
  });

  it('skips rate-limited providers and still returns a free model', () => {
    const route = chooseBestAutoModel({
      prompt: 'refactore diese TypeScript Funktion',
      availableModels: models,
      unavailableProviderIds: ['kimi', 'claude'],
      fallbackModel: 'haiku',
    });
    expect(route.model).toBe('Gemini 3.7 Flash (High)');
    expect(route.providerId).toBe('antigravity');
  });

  it('uses High effort for hard work when Gemini is the only free family', () => {
    const route = chooseBestAutoModel({
      prompt: 'plane die komplette Architektur und alle Meilensteine',
      availableModels: models,
      unavailableProviderIds: ['claude', 'kimi'],
      fallbackModel: 'haiku',
    });
    expect(route.model).toBe('Gemini 3.7 Flash (High)');
  });
});
