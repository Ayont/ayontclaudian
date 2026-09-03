import {
  CODEX_GPT_6_ASTRA_MODEL,
  CODEX_GPT_6_ASTRA_MINI_MODEL,
  CODEX_GPT_56_SOL_MODEL,
  DEFAULT_CODEX_MODELS,
  formatCodexModelLabel,
  getCodexModelContextWindow,
  isCodexGpt6Model,
  supportsCodexFastTier,
  supportsCodexMaxEffort,
  supportsCodexUltraEffort,
} from '@/providers/codex/types/models';

describe('Codex GPT-6 Astra Models', () => {
  it('formats labels for GPT-6 Astra family correctly', () => {
    expect(formatCodexModelLabel('gpt-6-astra')).toBe('GPT-6 Astra');
    expect(formatCodexModelLabel('gpt-6-astra-mini')).toBe('GPT-6 Astra Mini');
    expect(formatCodexModelLabel('gpt-5.6-sol')).toBe('GPT-5.6 Sol');
  });

  it('identifies GPT-6 models', () => {
    expect(isCodexGpt6Model(CODEX_GPT_6_ASTRA_MODEL)).toBe(true);
    expect(isCodexGpt6Model(CODEX_GPT_6_ASTRA_MINI_MODEL)).toBe(true);
    expect(isCodexGpt6Model(CODEX_GPT_56_SOL_MODEL)).toBe(false);
  });

  it('includes GPT-6 Astra in default models with Coming Soon badge', () => {
    const astra = DEFAULT_CODEX_MODELS.find(m => m.value === CODEX_GPT_6_ASTRA_MODEL);
    expect(astra).toBeDefined();
    expect(astra?.badge).toBe('Coming Soon');
    expect(astra?.comingSoon).toBe(true);

    const mini = DEFAULT_CODEX_MODELS.find(m => m.value === CODEX_GPT_6_ASTRA_MINI_MODEL);
    expect(mini).toBeDefined();
    expect(mini?.badge).toBe('Coming Soon');
    expect(mini?.comingSoon).toBe(true);
  });

  it('supports max and ultra effort for GPT-6 Astra', () => {
    expect(supportsCodexMaxEffort(CODEX_GPT_6_ASTRA_MODEL)).toBe(true);
    expect(supportsCodexUltraEffort(CODEX_GPT_6_ASTRA_MODEL)).toBe(true);
    expect(supportsCodexFastTier(CODEX_GPT_6_ASTRA_MODEL)).toBe(true);
  });

  it('provides expanded 2M context window for GPT-6 Astra', () => {
    expect(getCodexModelContextWindow(CODEX_GPT_6_ASTRA_MODEL)).toBe(2_000_000);
    expect(getCodexModelContextWindow(CODEX_GPT_6_ASTRA_MINI_MODEL)).toBe(1_050_000);
  });
});
