import {
  CODEX_GPT_55_MODEL,
  CODEX_GPT_56_LUNA_MODEL,
  CODEX_GPT_56_SOL_MODEL,
  CODEX_GPT_56_TERRA_MODEL,
  CODEX_SPARK_MODEL,
  DEFAULT_CODEX_MINI_MODEL,
  DEFAULT_CODEX_PRIMARY_MODEL,
} from '@/providers/codex/types/models';
import { codexChatUIConfig } from '@/providers/codex/ui/CodexChatUIConfig';

describe('CodexChatUIConfig', () => {
  describe('getModelOptions', () => {
    it('should return default models when no env vars', () => {
      const options = codexChatUIConfig.getModelOptions({});
      expect(options).toHaveLength(5);
      expect(options.map(o => o.value)).toEqual([
        DEFAULT_CODEX_PRIMARY_MODEL,
        CODEX_GPT_56_TERRA_MODEL,
        CODEX_GPT_56_LUNA_MODEL,
        CODEX_GPT_55_MODEL,
        DEFAULT_CODEX_MINI_MODEL,
      ]);
    });

    it('appends settings-defined custom models after the built-in options', () => {
      const options = codexChatUIConfig.getModelOptions({
        providerConfigs: {
          codex: {
            customModels: 'gpt-5.6-preview\nmy-custom-model\nmy-custom-model',
          },
        },
      });

      expect(options).toEqual([
        {
          value: CODEX_GPT_56_SOL_MODEL,
          label: 'GPT-5.6 Sol',
          description: 'Flagship GPT-5.6 model for complex coding',
        },
        {
          value: CODEX_GPT_56_TERRA_MODEL,
          label: 'GPT-5.6 Terra',
          description: 'Balanced GPT-5.6 model for everyday work',
        },
        {
          value: CODEX_GPT_56_LUNA_MODEL,
          label: 'GPT-5.6 Luna',
          description: 'Fast and cost-efficient GPT-5.6 model',
        },
        {
          value: CODEX_GPT_55_MODEL,
          label: 'GPT-5.5',
          description: 'Previous frontier model',
        },
        {
          value: DEFAULT_CODEX_MINI_MODEL,
          label: 'GPT-5.4 Mini',
          description: 'Fast legacy mini model',
        },
        {
          value: 'gpt-5.6-preview',
          label: 'GPT-5.6 Preview',
          description: 'Custom model',
        },
        {
          value: 'my-custom-model',
          label: 'my-custom-model',
          description: 'Custom model',
        },
      ]);
    });

    it('should prepend custom model from OPENAI_MODEL env var', () => {
      const options = codexChatUIConfig.getModelOptions({
        environmentVariables: 'OPENAI_MODEL=my-custom-model',
      });
      expect(options[0].value).toBe('my-custom-model');
      expect(options[0].description).toBe('Custom (env)');
      expect(options.length).toBe(6);
    });

    it('deduplicates env and settings-defined custom models', () => {
      const options = codexChatUIConfig.getModelOptions({
        providerConfigs: {
          codex: {
            customModels: 'my-custom-model\nsecond-custom-model',
            environmentVariables: 'OPENAI_MODEL=my-custom-model',
          },
        },
      });

      expect(options.map(option => option.value)).toEqual([
        'my-custom-model',
        DEFAULT_CODEX_PRIMARY_MODEL,
        CODEX_GPT_56_TERRA_MODEL,
        CODEX_GPT_56_LUNA_MODEL,
        CODEX_GPT_55_MODEL,
        DEFAULT_CODEX_MINI_MODEL,
        'second-custom-model',
      ]);
    });

    it('should not duplicate when OPENAI_MODEL matches a default model', () => {
      const options = codexChatUIConfig.getModelOptions({
        environmentVariables: `OPENAI_MODEL=${DEFAULT_CODEX_PRIMARY_MODEL}`,
      });
      expect(options.length).toBe(5);
    });
  });

  describe('isAdaptiveReasoningModel', () => {
    it('should return true for all models', () => {
      expect(codexChatUIConfig.isAdaptiveReasoningModel(DEFAULT_CODEX_PRIMARY_MODEL, {})).toBe(true);
      expect(codexChatUIConfig.isAdaptiveReasoningModel('unknown-model', {})).toBe(true);
    });
  });

  describe('getReasoningOptions', () => {
    it('adds max and ultra effort levels for GPT-5.6 Sol/Terra', () => {
      const options = codexChatUIConfig.getReasoningOptions(DEFAULT_CODEX_PRIMARY_MODEL, {});
      expect(options.map(o => o.value)).toEqual(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
    });

    it('adds max but not ultra for GPT-5.6 Luna', () => {
      const options = codexChatUIConfig.getReasoningOptions(CODEX_GPT_56_LUNA_MODEL, {});
      expect(options.map(o => o.value)).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    });

    it('keeps legacy effort levels for pre-GPT-5.6 models', () => {
      const options = codexChatUIConfig.getReasoningOptions(CODEX_GPT_55_MODEL, {});
      expect(options.map(o => o.value)).toEqual(['low', 'medium', 'high', 'xhigh']);
    });
  });

  describe('getDefaultReasoningValue', () => {
    it('should return medium for all models', () => {
      expect(codexChatUIConfig.getDefaultReasoningValue(DEFAULT_CODEX_PRIMARY_MODEL, {})).toBe('medium');
    });
  });

  describe('getContextWindowSize', () => {
    it('should return 1.05M for GPT-5.6 models', () => {
      expect(codexChatUIConfig.getContextWindowSize(DEFAULT_CODEX_PRIMARY_MODEL)).toBe(1_050_000);
      expect(codexChatUIConfig.getContextWindowSize(CODEX_GPT_56_TERRA_MODEL)).toBe(1_050_000);
      expect(codexChatUIConfig.getContextWindowSize(CODEX_GPT_56_LUNA_MODEL)).toBe(1_050_000);
    });

    it('should return 200000 for legacy models', () => {
      expect(codexChatUIConfig.getContextWindowSize(CODEX_GPT_55_MODEL)).toBe(200_000);
    });
  });

  describe('applyModelDefaults', () => {
    it('sets reasoning summary off for GPT-5.3 Codex Spark', () => {
      const settings: Record<string, unknown> = {
        providerConfigs: {
          codex: {
            reasoningSummary: 'detailed',
          },
        },
      };

      codexChatUIConfig.applyModelDefaults(CODEX_SPARK_MODEL, settings);

      expect(settings).toMatchObject({
        providerConfigs: {
          codex: {
            reasoningSummary: 'none',
          },
        },
      });
    });

    it('leaves reasoning summary unchanged for other Codex models', () => {
      const settings: Record<string, unknown> = {
        providerConfigs: {
          codex: {
            reasoningSummary: 'detailed',
          },
        },
      };

      codexChatUIConfig.applyModelDefaults(DEFAULT_CODEX_PRIMARY_MODEL, settings);

      expect(settings).toMatchObject({
        providerConfigs: {
          codex: {
            reasoningSummary: 'detailed',
          },
        },
      });
    });
  });

  describe('isDefaultModel', () => {
    it('should return true for built-in models', () => {
      expect(codexChatUIConfig.isDefaultModel(DEFAULT_CODEX_PRIMARY_MODEL)).toBe(true);
      expect(codexChatUIConfig.isDefaultModel(DEFAULT_CODEX_MINI_MODEL)).toBe(true);
    });

    it('should return false for custom models', () => {
      expect(codexChatUIConfig.isDefaultModel('my-custom-model')).toBe(false);
    });
  });

  describe('normalizeModelVariant', () => {
    it('falls back unavailable Codex models to the current primary model', () => {
      expect(codexChatUIConfig.normalizeModelVariant('gpt-5.4', {})).toBe(DEFAULT_CODEX_PRIMARY_MODEL);
    });

    it('keeps visible models as-is', () => {
      expect(codexChatUIConfig.normalizeModelVariant(DEFAULT_CODEX_PRIMARY_MODEL, {})).toBe(DEFAULT_CODEX_PRIMARY_MODEL);
      expect(codexChatUIConfig.normalizeModelVariant('custom', {
        environmentVariables: 'OPENAI_MODEL=custom',
      })).toBe('custom');
      expect(codexChatUIConfig.normalizeModelVariant('settings-custom', {
        providerConfigs: {
          codex: {
            customModels: 'settings-custom',
          },
        },
      })).toBe('settings-custom');
    });
  });

  describe('getCustomModelIds', () => {
    it('should return custom model from env', () => {
      const ids = codexChatUIConfig.getCustomModelIds({ OPENAI_MODEL: 'my-model' });
      expect(ids.has('my-model')).toBe(true);
    });

    it('should not include default models', () => {
      const ids = codexChatUIConfig.getCustomModelIds({ OPENAI_MODEL: DEFAULT_CODEX_PRIMARY_MODEL });
      expect(ids.size).toBe(0);
    });

    it('should return empty set when no OPENAI_MODEL', () => {
      const ids = codexChatUIConfig.getCustomModelIds({});
      expect(ids.size).toBe(0);
    });
  });

  describe('getPermissionModeToggle', () => {
    it('should return yolo/safe toggle config with plan mode', () => {
      const toggle = codexChatUIConfig.getPermissionModeToggle!();
      expect(toggle).toEqual({
        inactiveValue: 'normal',
        inactiveLabel: 'Safe',
        activeValue: 'yolo',
        activeLabel: 'YOLO',
        planValue: 'plan',
        planLabel: 'Plan',
      });
    });
  });
});
