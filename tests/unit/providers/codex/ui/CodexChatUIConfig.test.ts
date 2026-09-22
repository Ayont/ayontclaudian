import {
  CODEX_GPT_6_ASTRA_MODEL,
  CODEX_GPT_6_LUNA_MODEL,
  CODEX_GPT_6_SOL_MODEL,
  CODEX_GPT_55_MODEL,
  CODEX_GPT_56_LUNA_MODEL,
  CODEX_GPT_56_SOL_MODEL,
  CODEX_GPT_56_TERRA_MODEL,
  CODEX_SPARK_MODEL,
  DEFAULT_CODEX_PRIMARY_MODEL,
} from '@/providers/codex/types/models';
import { codexChatUIConfig } from '@/providers/codex/ui/CodexChatUIConfig';

describe('CodexChatUIConfig', () => {
  describe('getModelOptions', () => {
    it('should return default models when no env vars', () => {
      const options = codexChatUIConfig.getModelOptions({});
      expect(options).toHaveLength(7);
      expect(DEFAULT_CODEX_PRIMARY_MODEL).toBe(CODEX_GPT_6_SOL_MODEL);
      expect(options.map(o => o.value)).toEqual([
        DEFAULT_CODEX_PRIMARY_MODEL,
        CODEX_GPT_6_ASTRA_MODEL,
        CODEX_GPT_6_LUNA_MODEL,
        CODEX_GPT_56_SOL_MODEL,
        CODEX_GPT_56_TERRA_MODEL,
        CODEX_GPT_56_LUNA_MODEL,
        CODEX_GPT_55_MODEL,
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
          value: CODEX_GPT_6_SOL_MODEL,
          label: 'GPT-6 Sol',
          description: 'Neues Sol: Alltagsmodell für komplexe Aufgaben und Coding, schont die Nutzungslimits',
        },
        {
          value: CODEX_GPT_6_ASTRA_MODEL,
          label: 'GPT-6 Astra',
          description: 'Leistungsfähigstes OpenAI-Modell für komplexe, anspruchsvolle Aufgaben',
        },
        {
          value: CODEX_GPT_6_LUNA_MODEL,
          label: 'GPT-6 Luna',
          description: 'Neue Luna: sehr effizient für alles ohne Frontier-Anspruch',
        },
        {
          value: CODEX_GPT_56_SOL_MODEL,
          label: 'GPT-5.6 Sol',
          description: 'Vorheriges Sol-Modell für komplexes Coding · Nachfolger: GPT-6 Sol',
        },
        {
          value: CODEX_GPT_56_TERRA_MODEL,
          label: 'GPT-5.6 Terra',
          description: 'Ausgewogenes GPT-5.6-Modell für den Alltag · Nachfolger: GPT-6 Sol',
        },
        {
          value: CODEX_GPT_56_LUNA_MODEL,
          label: 'GPT-5.6 Luna',
          description: 'Vorheriges Luna-Modell, schnell und günstig · Nachfolger: GPT-6 Luna',
        },
        {
          value: CODEX_GPT_55_MODEL,
          label: 'GPT-5.5',
          description: 'Älteres Frontier-Modell · Nachfolger: GPT-5.6 Sol',
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
      expect(options.length).toBe(8);
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
        CODEX_GPT_6_ASTRA_MODEL,
        CODEX_GPT_6_LUNA_MODEL,
        CODEX_GPT_56_SOL_MODEL,
        CODEX_GPT_56_TERRA_MODEL,
        CODEX_GPT_56_LUNA_MODEL,
        CODEX_GPT_55_MODEL,
        'second-custom-model',
      ]);
    });

    it('should not duplicate when OPENAI_MODEL matches a default model', () => {
      const options = codexChatUIConfig.getModelOptions({
        environmentVariables: `OPENAI_MODEL=${DEFAULT_CODEX_PRIMARY_MODEL}`,
      });
      expect(options.length).toBe(7);
    });
  });

  describe('isAdaptiveReasoningModel', () => {
    it('should return true for all models', () => {
      expect(codexChatUIConfig.isAdaptiveReasoningModel(DEFAULT_CODEX_PRIMARY_MODEL, {})).toBe(true);
      expect(codexChatUIConfig.isAdaptiveReasoningModel('unknown-model', {})).toBe(true);
    });
  });

  describe('getReasoningOptions', () => {
    it('offers all six verified reasoning levels for GPT-6 Astra', () => {
      expect(codexChatUIConfig.getReasoningOptions(CODEX_GPT_6_ASTRA_MODEL, {}).map(option => option.value))
        .toEqual(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
    });

    it('adds max and ultra effort levels for GPT-5.6 Sol/Terra', () => {
      const options = codexChatUIConfig.getReasoningOptions(CODEX_GPT_56_SOL_MODEL, {});
      expect(options.map(o => o.value)).toEqual(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
    });

    it('offers all six levels for GPT-6 Sol, as the Codex catalog lists them', () => {
      expect(codexChatUIConfig.getReasoningOptions(CODEX_GPT_6_SOL_MODEL, {}).map(o => o.value))
        .toEqual(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
    });

    it('offers max but not ultra for GPT-6 Luna, as the Codex catalog lists it', () => {
      expect(codexChatUIConfig.getReasoningOptions(CODEX_GPT_6_LUNA_MODEL, {}).map(o => o.value))
        .toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
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
    it('uses the effective Codex default context for Astra until live telemetry arrives', () => {
      expect(codexChatUIConfig.getContextWindowSize(CODEX_GPT_6_ASTRA_MODEL)).toBe(258_400);
      expect(codexChatUIConfig.getContextWindowSize(CODEX_GPT_6_ASTRA_MODEL, {
        [CODEX_GPT_6_ASTRA_MODEL]: 828_400,
      })).toBe(828_400);
    });

    it('uses the effective Codex default context for GPT-6 Sol and Luna', () => {
      expect(codexChatUIConfig.getContextWindowSize(CODEX_GPT_6_SOL_MODEL)).toBe(258_400);
      expect(codexChatUIConfig.getContextWindowSize(CODEX_GPT_6_LUNA_MODEL)).toBe(258_400);
    });

    it('uses the catalog window for GPT-5.6 and GPT-5.5 as well', () => {
      expect(codexChatUIConfig.getContextWindowSize(CODEX_GPT_56_SOL_MODEL)).toBe(258_400);
      expect(codexChatUIConfig.getContextWindowSize(CODEX_GPT_56_TERRA_MODEL)).toBe(258_400);
      expect(codexChatUIConfig.getContextWindowSize(CODEX_GPT_56_LUNA_MODEL)).toBe(258_400);
      expect(codexChatUIConfig.getContextWindowSize(CODEX_GPT_55_MODEL)).toBe(258_400);
    });

    it('should return 200000 for unknown models', () => {
      expect(codexChatUIConfig.getContextWindowSize('gpt-9-unknown')).toBe(200_000);
    });

    // Regression: the signature omitted the `customLimits` argument that every
    // caller passes, so a per-model override entered in Settings validated, saved,
    // and was then silently ignored — every other provider honours it.
    it('prefers a user-configured custom context limit', () => {
      const customLimits = { 'gpt-5.6-sol-preview': 400_000 };
      expect(codexChatUIConfig.getContextWindowSize('gpt-5.6-sol-preview', customLimits)).toBe(400_000);
    });

    it('overrides even a known built-in model when a custom limit is set', () => {
      const customLimits = { [CODEX_GPT_55_MODEL]: 512_000 };
      expect(codexChatUIConfig.getContextWindowSize(CODEX_GPT_55_MODEL, customLimits)).toBe(512_000);
    });

    it('ignores invalid custom limits and falls back to the built-in value', () => {
      expect(codexChatUIConfig.getContextWindowSize(CODEX_GPT_55_MODEL, { [CODEX_GPT_55_MODEL]: 0 })).toBe(258_400);
      expect(codexChatUIConfig.getContextWindowSize(CODEX_GPT_55_MODEL, { [CODEX_GPT_55_MODEL]: -5 })).toBe(258_400);
      expect(codexChatUIConfig.getContextWindowSize(CODEX_GPT_55_MODEL, { other: 999 })).toBe(258_400);
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
      expect(codexChatUIConfig.isDefaultModel(CODEX_GPT_55_MODEL)).toBe(true);
      expect(codexChatUIConfig.isDefaultModel('gpt-5.4-mini')).toBe(false);
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

  describe('getServiceTierToggle', () => {
    it('offers Fast on GPT-6 Sol and Luna', () => {
      expect(codexChatUIConfig.getServiceTierToggle?.({ model: CODEX_GPT_6_SOL_MODEL })).not.toBeNull();
      expect(codexChatUIConfig.getServiceTierToggle?.({ model: CODEX_GPT_6_LUNA_MODEL })).not.toBeNull();
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
