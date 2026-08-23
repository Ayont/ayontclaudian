import {
  decodeHermesModelId,
  describeHermesModel,
  encodeHermesModelId,
  groupHermesDiscoveredModels,
  HERMES_SYNTHETIC_MODEL_ID,
  isHermesModelSelectionId,
  normalizeHermesDiscoveredModels,
  splitHermesRawModelId,
} from '@/providers/hermes/models';

describe('Hermes model ids', () => {
  it('round-trips a provider-qualified raw id', () => {
    const rawId = 'openrouter:anthropic/claude-opus-5';

    const encoded = encodeHermesModelId(rawId);

    expect(encoded).toBe('hermes:openrouter:anthropic/claude-opus-5');
    expect(decodeHermesModelId(encoded)).toBe(rawId);
    expect(isHermesModelSelectionId(encoded)).toBe(true);
  });

  it('falls back to the synthetic id for an empty raw id', () => {
    expect(encodeHermesModelId('   ')).toBe(HERMES_SYNTHETIC_MODEL_ID);
    expect(isHermesModelSelectionId(HERMES_SYNTHETIC_MODEL_ID)).toBe(true);
  });

  it('does not claim other providers\' model ids', () => {
    expect(isHermesModelSelectionId('opencode:anthropic/claude-opus-5')).toBe(false);
    expect(decodeHermesModelId('opencode:anthropic/claude-opus-5')).toBeNull();
    expect(decodeHermesModelId('hermes:')).toBeNull();
  });
});

describe('splitHermesRawModelId', () => {
  it('splits on the last colon so named endpoints keep their prefix', () => {
    expect(splitHermesRawModelId('custom:ollama:llama3.3')).toEqual({
      modelId: 'llama3.3',
      providerId: 'custom:ollama',
    });
  });

  it('returns an empty provider for an unqualified id', () => {
    expect(splitHermesRawModelId('gpt-5')).toEqual({ modelId: 'gpt-5', providerId: '' });
  });
});

describe('describeHermesModel', () => {
  it('uses the provider separator Hermes already sends', () => {
    expect(describeHermesModel({
      label: 'OpenRouter · anthropic/claude-opus-5',
      rawId: 'openrouter:anthropic/claude-opus-5',
    })).toEqual({
      modelLabel: 'anthropic/claude-opus-5',
      providerLabel: 'OpenRouter',
    });
  });

  it('derives the provider from the raw id when the label carries none', () => {
    expect(describeHermesModel({
      label: 'llama3.3',
      rawId: 'custom:ollama:llama3.3',
    })).toEqual({
      modelLabel: 'llama3.3',
      providerLabel: 'custom:ollama',
    });
  });
});

describe('normalizeHermesDiscoveredModels', () => {
  it('drops entries without a raw id and deduplicates', () => {
    expect(normalizeHermesDiscoveredModels([
      { label: 'A', rawId: 'openrouter:a' },
      { label: 'A again', rawId: 'openrouter:a' },
      { label: 'No id', rawId: '  ' },
      'not an object',
      { description: '  Fast  ', label: '  ', rawId: ' openrouter:b ' },
    ])).toEqual([
      { label: 'A', rawId: 'openrouter:a' },
      { description: 'Fast', label: 'openrouter:b', rawId: 'openrouter:b' },
    ]);
  });

  it('returns an empty list for non-array input', () => {
    expect(normalizeHermesDiscoveredModels(undefined)).toEqual([]);
  });
});

describe('groupHermesDiscoveredModels', () => {
  it('groups by provider label and sorts both levels', () => {
    const groups = groupHermesDiscoveredModels([
      { label: 'OpenRouter · z-model', rawId: 'openrouter:z-model' },
      { label: 'Anthropic · claude-opus-5', rawId: 'anthropic:claude-opus-5' },
      { label: 'OpenRouter · a-model', rawId: 'openrouter:a-model' },
    ]);

    expect(groups.map((group) => group.providerLabel)).toEqual(['Anthropic', 'OpenRouter']);
    expect(groups[1].models.map((model) => model.rawId)).toEqual([
      'openrouter:a-model',
      'openrouter:z-model',
    ]);
  });
});
