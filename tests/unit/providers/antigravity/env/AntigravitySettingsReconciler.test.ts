import type { Conversation } from '@/core/types';
import { antigravitySettingsReconciler } from '@/providers/antigravity/env/AntigravitySettingsReconciler';

describe('antigravitySettingsReconciler', () => {
  it('leaves environment reconciliation inert (agy has no env-driven model variants)', () => {
    const settings: Record<string, unknown> = { model: 'Gemini 3.8 Flash (High)' };
    const result = antigravitySettingsReconciler.reconcileModelWithEnvironment(settings, [] as Conversation[]);
    expect(result).toEqual({ changed: false, invalidatedConversations: [] });
    expect(settings.model).toBe('Gemini 3.8 Flash (High)');
  });

  describe('normalizeModelVariantSettings', () => {
    // agy 1.1.24 answers `--model "Gemini 3.5 Flash (High)"` with status ERROR
    // ("not recognized as a known model"). A value persisted by an older build
    // must therefore be migrated on load, not handed to the CLI.
    it('migrates a retired Gemini 3.5 Flash model to Gemini 3.8 Flash at the same tier', () => {
      const settings: Record<string, unknown> = { model: 'Gemini 3.5 Flash (Medium)' };
      expect(antigravitySettingsReconciler.normalizeModelVariantSettings(settings)).toBe(true);
      expect(settings.model).toBe('Gemini 3.8 Flash (Medium)');
    });

    it('migrates a retired slug spelling too', () => {
      const settings: Record<string, unknown> = { model: 'gemini-3.5-flash-low' };
      expect(antigravitySettingsReconciler.normalizeModelVariantSettings(settings)).toBe(true);
      expect(settings.model).toBe('gemini-3.8-flash-low');
    });

    it('leaves current models and the synthetic default untouched', () => {
      for (const model of ['Gemini 3.8 Flash (High)', 'gemini-3.7-flash-high', 'antigravity-default', 'Claude Opus 4.6 (Thinking)']) {
        const settings: Record<string, unknown> = { model };
        expect(antigravitySettingsReconciler.normalizeModelVariantSettings(settings)).toBe(false);
        expect(settings.model).toBe(model);
      }
    });

    it('ignores a non-string or missing model', () => {
      expect(antigravitySettingsReconciler.normalizeModelVariantSettings({})).toBe(false);
      expect(antigravitySettingsReconciler.normalizeModelVariantSettings({ model: 42 })).toBe(false);
    });
  });
});
