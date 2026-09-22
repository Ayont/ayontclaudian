import { resolveCodexModelSelection } from '@/providers/codex/modelOptions';
import {
  CODEX_GPT_6_ASTRA_MODEL,
  CODEX_GPT_6_LUNA_MODEL,
  CODEX_GPT_6_SOL_MODEL,
  CODEX_GPT_56_LUNA_MODEL,
  CODEX_GPT_56_SOL_MODEL,
  DEFAULT_CODEX_MODELS,
  DEFAULT_CODEX_PRIMARY_MODEL,
  FAST_TIER_CODEX_DESCRIPTION,
  formatCodexModelLabel,
  getCodexModelContextWindow,
  isCodexGpt6Model,
  supportsCodexFastTier,
  supportsCodexMaxEffort,
  supportsCodexUltraEffort,
} from '@/providers/codex/types/models';

describe('Codex GPT-6 Astra Model', () => {
  it('formats label for GPT-6 Astra correctly', () => {
    expect(formatCodexModelLabel('gpt-6-astra')).toBe('GPT-6 Astra');
    expect(formatCodexModelLabel('gpt-5.6-sol')).toBe('GPT-5.6 Sol');
  });

  it('identifies GPT-6 models', () => {
    expect(isCodexGpt6Model(CODEX_GPT_6_ASTRA_MODEL)).toBe(true);
    expect(isCodexGpt6Model(CODEX_GPT_56_SOL_MODEL)).toBe(false);
  });

  it('includes GPT-6 Astra as an available built-in model', () => {
    const astra = DEFAULT_CODEX_MODELS.find(m => m.value === CODEX_GPT_6_ASTRA_MODEL);
    expect(astra).toBeDefined();
    expect(astra?.badge).toBeUndefined();
    expect(astra?.comingSoon).toBeUndefined();
    expect(astra?.description).not.toMatch(/rollout|coming soon/i);
  });

  it('supports max and ultra effort for GPT-6 Astra', () => {
    expect(supportsCodexMaxEffort(CODEX_GPT_6_ASTRA_MODEL)).toBe(true);
    expect(supportsCodexUltraEffort(CODEX_GPT_6_ASTRA_MODEL)).toBe(true);
    expect(supportsCodexFastTier(CODEX_GPT_6_ASTRA_MODEL)).toBe(true);
  });

  it('uses the verified effective default context window for GPT-6 Astra', () => {
    expect(getCodexModelContextWindow(CODEX_GPT_6_ASTRA_MODEL)).toBe(258_400);
  });

  it('preserves Astra selections without making Astra the default', () => {
    expect(resolveCodexModelSelection({}, CODEX_GPT_6_ASTRA_MODEL)).toBe(CODEX_GPT_6_ASTRA_MODEL);
    expect(resolveCodexModelSelection({}, '')).not.toBe(CODEX_GPT_6_ASTRA_MODEL);
  });
});

// Rows read from codex-cli 0.155.1's models_cache.json (fetched 2026-09-22):
// gpt-6-sol and gpt-6-luna, both context_window 272000 at 95% effective,
// Fast tier, default reasoning medium. Sol reasons low..ultra, Luna low..max.
// The catalog names them the upgrade targets of gpt-5.6-sol / gpt-5.6-luna.
describe('Codex GPT-6 Sol and Luna', () => {
  it('formats labels from the model ids', () => {
    expect(formatCodexModelLabel(CODEX_GPT_6_SOL_MODEL)).toBe('GPT-6 Sol');
    expect(formatCodexModelLabel(CODEX_GPT_6_LUNA_MODEL)).toBe('GPT-6 Luna');
  });

  it('treats both as GPT-6 models', () => {
    expect(isCodexGpt6Model(CODEX_GPT_6_SOL_MODEL)).toBe(true);
    expect(isCodexGpt6Model(CODEX_GPT_6_LUNA_MODEL)).toBe(true);
    expect(isCodexGpt6Model(CODEX_GPT_56_LUNA_MODEL)).toBe(false);
  });

  it('offers both as regular built-in models', () => {
    for (const value of [CODEX_GPT_6_SOL_MODEL, CODEX_GPT_6_LUNA_MODEL]) {
      const option = DEFAULT_CODEX_MODELS.find(m => m.value === value);
      expect(option).toBeDefined();
      expect(option?.badge).toBeUndefined();
      expect(option?.comingSoon).toBeUndefined();
    }
  });

  it('gives Sol max and ultra, and Luna max without ultra', () => {
    expect(supportsCodexMaxEffort(CODEX_GPT_6_SOL_MODEL)).toBe(true);
    expect(supportsCodexUltraEffort(CODEX_GPT_6_SOL_MODEL)).toBe(true);
    expect(supportsCodexMaxEffort(CODEX_GPT_6_LUNA_MODEL)).toBe(true);
    expect(supportsCodexUltraEffort(CODEX_GPT_6_LUNA_MODEL)).toBe(false);
  });

  it('offers the Fast tier on both', () => {
    expect(supportsCodexFastTier(CODEX_GPT_6_SOL_MODEL)).toBe(true);
    expect(supportsCodexFastTier(CODEX_GPT_6_LUNA_MODEL)).toBe(true);
  });

  it('uses the same effective default window as Astra until live telemetry arrives', () => {
    expect(getCodexModelContextWindow(CODEX_GPT_6_SOL_MODEL)).toBe(258_400);
    expect(getCodexModelContextWindow(CODEX_GPT_6_LUNA_MODEL)).toBe(258_400);
  });

  it('makes GPT-6 Sol the default, following the catalog upgrade from GPT-5.6 Sol', () => {
    expect(DEFAULT_CODEX_PRIMARY_MODEL).toBe(CODEX_GPT_6_SOL_MODEL);
    expect(resolveCodexModelSelection({}, '')).toBe(CODEX_GPT_6_SOL_MODEL);
    expect(resolveCodexModelSelection({}, 'removed-custom-model')).toBe(CODEX_GPT_6_SOL_MODEL);
    expect(DEFAULT_CODEX_MODELS.find(model => !model.comingSoon)?.value).toBe(CODEX_GPT_6_SOL_MODEL);
  });

  it('never moves an explicit GPT-5.6 choice onto GPT-6', () => {
    expect(resolveCodexModelSelection({}, CODEX_GPT_56_SOL_MODEL)).toBe(CODEX_GPT_56_SOL_MODEL);
    expect(resolveCodexModelSelection({}, CODEX_GPT_56_LUNA_MODEL)).toBe(CODEX_GPT_56_LUNA_MODEL);
  });

  it('names the GPT-6 family in the Fast-tier hint', () => {
    expect(FAST_TIER_CODEX_DESCRIPTION).toMatch(/GPT-6/);
    expect(FAST_TIER_CODEX_DESCRIPTION).not.toMatch(/GPT-6 Astra und/);
  });
});
