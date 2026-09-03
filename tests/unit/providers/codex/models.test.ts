import {
  CODEX_GPT_6_ASTRA_MODEL,
  CODEX_GPT_56_SOL_MODEL,
  DEFAULT_CODEX_MODELS,
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

  it('includes GPT-6 Astra in default models with Coming Soon badge', () => {
    const astra = DEFAULT_CODEX_MODELS.find(m => m.value === CODEX_GPT_6_ASTRA_MODEL);
    expect(astra).toBeDefined();
    expect(astra?.badge).toBe('Coming Soon');
    expect(astra?.comingSoon).toBe(true);
  });

  it('supports max and ultra effort for GPT-6 Astra', () => {
    expect(supportsCodexMaxEffort(CODEX_GPT_6_ASTRA_MODEL)).toBe(true);
    expect(supportsCodexUltraEffort(CODEX_GPT_6_ASTRA_MODEL)).toBe(true);
    expect(supportsCodexFastTier(CODEX_GPT_6_ASTRA_MODEL)).toBe(true);
  });

  it('provides expanded context window for GPT-6 Astra', () => {
    expect(getCodexModelContextWindow(CODEX_GPT_6_ASTRA_MODEL)).toBe(2_000_000);
  });
});
