import {
  getZcodeModelContextWindow,
  getZcodeModelOptions,
  parseCustomModels,
  resolveZcodeModelSelection,
} from '@/providers/zcode/modelOptions';
import { updateZcodeProviderSettings } from '@/providers/zcode/settings';
import {
  DEFAULT_ZCODE_CONTEXT_WINDOW,
  DEFAULT_ZCODE_PRIMARY_MODEL,
} from '@/providers/zcode/types/models';

describe('ZCode Model Options', () => {
  it('resolves correct context window for standard and custom models', () => {
    expect(getZcodeModelContextWindow('GLM-5.3')).toBe(1_000_000);
    expect(getZcodeModelContextWindow('glm-5.3')).toBe(1_000_000);
    expect(getZcodeModelContextWindow('GLM-5.3-Flash')).toBe(1_000_000);
    expect(getZcodeModelContextWindow('GLM-5-Turbo')).toBe(200_000);
    expect(getZcodeModelContextWindow('unknown-model')).toBe(DEFAULT_ZCODE_CONTEXT_WINDOW);
  });

  it('lists default models in model options', () => {
    const options = getZcodeModelOptions({});
    const values = options.map((o) => o.value);
    expect(values).toContain('GLM-5.3');
    expect(values).toContain('GLM-5.3-Flash');
    expect(values).toContain('GLM-5-Turbo');
  });

  it('parses custom models cleanly', () => {
    const custom = parseCustomModels('glm-custom-1:Custom One\nglm-custom-2');
    expect(custom).toHaveLength(2);
    expect(custom[0]).toEqual({
      value: 'glm-custom-1',
      label: 'Custom One',
      description: 'Benutzerdefiniertes Modell',
    });
    expect(custom[1]).toEqual({
      value: 'glm-custom-2',
      label: 'glm-custom-2',
      description: 'Benutzerdefiniertes Modell',
    });
  });

  it('includes custom models in getZcodeModelOptions', () => {
    const settingsBag: Record<string, unknown> = {};
    updateZcodeProviderSettings(settingsBag, (curr) => ({
      ...curr,
      customModels: 'my-custom-model:My Custom Label',
    }));

    const options = getZcodeModelOptions(settingsBag);
    expect(options.some((o) => o.value === 'my-custom-model')).toBe(true);
  });

  it('resolves model selection falling back to primary model', () => {
    expect(resolveZcodeModelSelection({}, '')).toBe(DEFAULT_ZCODE_PRIMARY_MODEL);
    expect(resolveZcodeModelSelection({}, 'GLM-5.3-Flash')).toBe('GLM-5.3-Flash');
  });
});
