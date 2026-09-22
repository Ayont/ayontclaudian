import { claudeChatUIConfig } from '@/providers/claude/ui/ClaudeChatUIConfig';

describe('claudeChatUIConfig', () => {
  describe('getModelOptions', () => {
    it('appends settings-defined custom models after the built-in options', () => {
      const options = claudeChatUIConfig.getModelOptions({
        providerConfigs: {
          claude: {
            customModels: 'claude-opus-4-6\nclaude-opus-4-6[1m]',
          },
        },
      });

      expect(options.map(option => option.value)).toEqual([
        'claude-fable-5-1',
        'claude-fable-5',
        'claude-opus-5-5',
        'claude-opus-5',
        'claude-opus-4-8',
        'claude-sonnet-5',
        'claude-opus-4-6',
        'claude-opus-4-6[1m]',
      ]);
      expect(options.slice(-2)).toEqual([
        {
          value: 'claude-opus-4-6',
          label: 'Opus 4.6',
          description: 'Eigenes Modell',
        },
        {
          value: 'claude-opus-4-6[1m]',
          label: 'Opus 4.6 (1M)',
          description: 'Eigenes Modell',
        },
      ]);
    });

    it('deduplicates settings-defined custom models against exact duplicates', () => {
      const options = claudeChatUIConfig.getModelOptions({
        providerConfigs: {
          claude: {
            customModels: 'haiku\nclaude-opus-4-6\nclaude-opus-4-6\n',
          },
        },
      });

      // `haiku` is no longer a built-in, so a user who lists it explicitly gets it
      // as a custom entry; the duplicate `claude-opus-4-6` line collapses to one.
      expect(options.map(option => option.value)).toEqual([
        'claude-fable-5-1',
        'claude-fable-5',
        'claude-opus-5-5',
        'claude-opus-5',
        'claude-opus-4-8',
        'claude-sonnet-5',
        'haiku',
        'claude-opus-4-6',
      ]);
    });

    it('formats dated settings-defined custom models with shortened date tags', () => {
      const options = claudeChatUIConfig.getModelOptions({
        providerConfigs: {
          claude: {
            customModels: 'claude-opus-4-5-20251101',
          },
        },
      });

      expect(options.at(-1)).toEqual({
        value: 'claude-opus-4-5-20251101',
        label: 'Opus 4.5 (2511)',
        description: 'Eigenes Modell',
      });
    });

    it('uses custom model aliases for settings-defined custom model labels', () => {
      const options = claudeChatUIConfig.getModelOptions({
        customModelAliases: {
          'claude-opus-4-6': 'Work Opus',
        },
        providerConfigs: {
          claude: {
            customModels: 'claude-opus-4-6',
          },
        },
      });

      expect(options.at(-1)).toEqual({
        value: 'claude-opus-4-6',
        label: 'Work Opus',
        description: 'Eigenes Modell',
      });
    });

    it('keeps environment-defined custom models as a full override', () => {
      const options = claudeChatUIConfig.getModelOptions({
        providerConfigs: {
          claude: {
            customModels: 'claude-opus-4-6',
            environmentVariables: 'ANTHROPIC_MODEL=claude-sonnet-4-5',
          },
        },
      });

      expect(options).toEqual([
        {
          value: 'claude-sonnet-4-5',
          label: 'Sonnet 4.5',
          description: 'Eigenes Modell (model)',
        },
      ]);
    });

    it('uses custom model aliases for environment-defined custom model labels', () => {
      const options = claudeChatUIConfig.getModelOptions({
        customModelAliases: {
          'claude-sonnet-4-5': 'Gateway Sonnet',
        },
        providerConfigs: {
          claude: {
            environmentVariables: 'ANTHROPIC_MODEL=claude-sonnet-4-5',
          },
        },
      });

      expect(options).toEqual([
        {
          value: 'claude-sonnet-4-5',
          label: 'Gateway Sonnet',
          description: 'Eigenes Modell (model)',
        },
      ]);
    });
  });

  describe('getReasoningOptions', () => {
    it('hides xhigh AND max on Sonnet 4.5 (the SDK rejects both there)', () => {
      const options = claudeChatUIConfig.getReasoningOptions('claude-sonnet-4-5', {});

      expect(options.map(option => option.value)).toEqual(['low', 'medium', 'high']);
    });

    it('hides xhigh but keeps max on Sonnet 4.6 (max landed one version earlier)', () => {
      const options = claudeChatUIConfig.getReasoningOptions('claude-sonnet-4-6', {});

      expect(options.map(option => option.value)).toEqual(['low', 'medium', 'high', 'max']);
    });

    it('offers the full ladder on the sonnet alias (resolves to Sonnet 5)', () => {
      const options = claudeChatUIConfig.getReasoningOptions('sonnet', {});

      expect(options.map(option => option.value)).toEqual(['low', 'medium', 'high', 'xhigh', 'max', 'ultracode']);
    });

    it('keeps xhigh on supported opus models', () => {
      const options = claudeChatUIConfig.getReasoningOptions('claude-opus-4-7', {});

      expect(options.map(option => option.value)).toEqual(['low', 'medium', 'high', 'xhigh', 'max', 'ultracode']);
    });

    it('uses effort options for custom model ids', () => {
      const options = claudeChatUIConfig.getReasoningOptions('custom-model', {});

      expect(options.map(option => option.value)).toEqual(['low', 'medium', 'high', 'max']);
      expect(options.some(option => option.tokens !== undefined)).toBe(false);
    });
  });

  describe('applyModelDefaults', () => {
    it('clamps stale xhigh effort when switching to a custom sonnet model', () => {
      const settings: Record<string, unknown> = {
        effortLevel: 'xhigh',
        providerConfigs: {},
      };

      claudeChatUIConfig.applyModelDefaults('claude-sonnet-4-5', settings);

      expect(settings.effortLevel).toBe('high');
      expect(settings.lastCustomModel).toBe('claude-sonnet-4-5');
    });

    it('preserves xhigh on custom opus models that support it', () => {
      const settings: Record<string, unknown> = {
        effortLevel: 'xhigh',
        providerConfigs: {},
      };

      claudeChatUIConfig.applyModelDefaults('claude-opus-4-7', settings);

      expect(settings.effortLevel).toBe('xhigh');
    });

    // Claude Code's own table sets default_effort "medium" for claude-opus-5-5,
    // one level below every other catalog model.
    it('starts Opus 5.5 at its native medium effort', () => {
      for (const model of ['claude-opus-5-5', 'claude-opus-5-5[1m]']) {
        const settings: Record<string, unknown> = { effortLevel: 'high', providerConfigs: {} };

        claudeChatUIConfig.applyModelDefaults(model, settings);

        expect(settings.effortLevel).toBe('medium');
        expect(claudeChatUIConfig.getDefaultReasoningValue(model, settings)).toBe('medium');
      }
    });

    it('keeps high as the starting effort for Opus 5', () => {
      const settings: Record<string, unknown> = { effortLevel: 'low', providerConfigs: {} };

      claudeChatUIConfig.applyModelDefaults('claude-opus-5', settings);

      expect(settings.effortLevel).toBe('high');
    });
  });

  describe('getReasoningOptions for Opus 5.5', () => {
    it('offers the full effort range including xhigh, max and ultracode', () => {
      const values = claudeChatUIConfig.getReasoningOptions('claude-opus-5-5', {}).map(option => option.value);

      expect(values).toEqual(['low', 'medium', 'high', 'xhigh', 'max', 'ultracode']);
    });
  });

  describe('getContextWindowSize for Opus 5.5', () => {
    it('reports the 1M window the CLI reads back from modelUsage', () => {
      expect(claudeChatUIConfig.getContextWindowSize('claude-opus-5-5')).toBe(1_000_000);
      expect(claudeChatUIConfig.getContextWindowSize('claude-opus-5-5[1m]')).toBe(1_000_000);
    });
  });

  describe('getServiceTierToggle', () => {
    it('exposes the Speed toggle on Opus models that support Claude fast mode', () => {
      const toggle = claudeChatUIConfig.getServiceTierToggle?.({ model: 'opus' });

      expect(toggle).toEqual({
        inactiveValue: 'default',
        inactiveLabel: 'Standard',
        activeValue: 'fast',
        activeLabel: 'Speed',
        description: expect.stringMatching(/2,5[x×]|2\.5x/),
      });
    });

    it('exposes the Speed toggle on Opus 5.5 in both spellings', () => {
      expect(claudeChatUIConfig.getServiceTierToggle?.({ model: 'claude-opus-5-5' })).not.toBeNull();
      expect(claudeChatUIConfig.getServiceTierToggle?.({ model: 'claude-opus-5-5[1m]' })).not.toBeNull();
    });

    it('hides the Speed toggle on Haiku, Sonnet, Fable, and Opus 4.7', () => {
      expect(claudeChatUIConfig.getServiceTierToggle?.({ model: 'haiku' })).toBeNull();
      expect(claudeChatUIConfig.getServiceTierToggle?.({ model: 'sonnet' })).toBeNull();
      expect(claudeChatUIConfig.getServiceTierToggle?.({ model: 'fable' })).toBeNull();
      expect(claudeChatUIConfig.getServiceTierToggle?.({ model: 'claude-opus-4-7' })).toBeNull();
    });
  });
});
