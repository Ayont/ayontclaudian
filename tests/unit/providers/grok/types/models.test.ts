import {
  DEFAULT_GROK_CONTEXT_WINDOW,
  DEFAULT_GROK_MODELS,
  DEFAULT_GROK_PRIMARY_MODEL,
  formatGrokModelLabel,
  KNOWN_GROK_MODEL_CONTEXT_WINDOWS,
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
    expect(DEFAULT_GROK_PRIMARY_MODEL).toBe('grok-4.6');
  });

  it('keeps the still-served previous generation selectable', () => {
    // `grok models` lists grok-4.5 alongside the 4.6 default, and `grok -m
    // grok-4.5` answers, so dropping it would remove a working choice.
    expect(DEFAULT_GROK_MODELS.map(m => m.value)).toContain('grok-4.5');
  });

  it('lists the default first and no retired ids', () => {
    const values = DEFAULT_GROK_MODELS.map(m => m.value);
    expect(values[0]).toBe(DEFAULT_GROK_PRIMARY_MODEL);
    for (const retired of RETIRED_MODEL_IDS) {
      expect(values).not.toContain(retired);
    }
  });

  it('publishes the served models\' real context windows', () => {
    expect(KNOWN_GROK_MODEL_CONTEXT_WINDOWS['grok-4.6']).toBe(500_000);
    expect(KNOWN_GROK_MODEL_CONTEXT_WINDOWS['grok-4.5']).toBe(500_000);
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
