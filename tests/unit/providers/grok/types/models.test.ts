import {
  DEFAULT_GROK_CONTEXT_WINDOW,
  DEFAULT_GROK_MODELS,
  DEFAULT_GROK_PRIMARY_MODEL,
  formatGrokModelLabel,
  getGrokReasoningEfforts,
  GROK_47_FAST_MODEL,
  GROK_LONG_CONTEXT_TOKEN_THRESHOLD,
  KNOWN_GROK_MODEL_CONTEXT_WINDOWS,
  normalizeGrokReasoningEffort,
} from '@/providers/grok/types/models';

describe('Grok model catalog', () => {
  // Ids the Grok CLI has served at some point and now rejects with
  // `Invalid params: "unknown model id"`. Verified against Grok CLI 1.0.0.
  const RETIRED_MODEL_IDS = [
    'grok-build-0.1',
    'grok-composer-2.5-fast',
    'grok-build',
    'grok-code-fast-1',
  ];

  it('uses the model id `grok models` actually reports as the default', () => {
    expect(DEFAULT_GROK_PRIMARY_MODEL).toBe('grok-4.7');
  });

  it('offers Grok 4.7 Fast and the still-served previous generations', () => {
    // `grok models` (CLI 1.0.40) lists grok-4.7-build-fast, grok-4.6 and
    // grok-4.5 next to the 4.7 default. Dropping any of them removes a model
    // the CLI still accepts.
    const values = DEFAULT_GROK_MODELS.map(m => m.value);
    expect(values).toContain(GROK_47_FAST_MODEL);
    expect(values).toContain('grok-4.6');
    expect(values).toContain('grok-4.5');
  });

  it('lists the default first and no retired ids', () => {
    const values = DEFAULT_GROK_MODELS.map(m => m.value);
    expect(values[0]).toBe(DEFAULT_GROK_PRIMARY_MODEL);
    for (const retired of RETIRED_MODEL_IDS) {
      expect(values).not.toContain(retired);
    }
  });

  it('publishes the served models\' real 500K context windows', () => {
    expect(KNOWN_GROK_MODEL_CONTEXT_WINDOWS['grok-4.7']).toBe(500_000);
    expect(KNOWN_GROK_MODEL_CONTEXT_WINDOWS[GROK_47_FAST_MODEL]).toBe(500_000);
    expect(KNOWN_GROK_MODEL_CONTEXT_WINDOWS['grok-4.6']).toBe(500_000);
    expect(KNOWN_GROK_MODEL_CONTEXT_WINDOWS['grok-4.5']).toBe(500_000);
    expect(GROK_LONG_CONTEXT_TOKEN_THRESHOLD).toBe(200_000);
  });

  it('offers xhigh on 4.7 and Fast, and drops it on 4.5', () => {
    expect(getGrokReasoningEfforts('grok-4.7')).toEqual(['xhigh', 'high', 'medium', 'low']);
    expect(getGrokReasoningEfforts(GROK_47_FAST_MODEL)).toEqual(['xhigh', 'high', 'medium', 'low']);
    expect(getGrokReasoningEfforts('grok-4.5')).toEqual(['high', 'medium', 'low']);
    expect(normalizeGrokReasoningEffort('xhigh', 'grok-4.5')).toBeNull();
    expect(normalizeGrokReasoningEffort('XHigh', 'grok-4.7')).toBe('xhigh');
  });

  it('keeps a 256K fallback window for unknown custom ids', () => {
    expect(DEFAULT_GROK_CONTEXT_WINDOW).toBe(256_000);
  });

  it('formats model ids into readable labels', () => {
    expect(formatGrokModelLabel('grok-composer-2.5-fast')).toBe('Grok Composer 2.5 Fast');
    expect(formatGrokModelLabel('grok-build')).toBe('Grok Build');
    expect(formatGrokModelLabel('grok-code-fast-1')).toBe('Grok Code Fast 1');
    expect(formatGrokModelLabel('')).toBe('Grok');
  });
});
