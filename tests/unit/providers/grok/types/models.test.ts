import {
  DEFAULT_GROK_CONTEXT_WINDOW,
  DEFAULT_GROK_MODELS,
  DEFAULT_GROK_PRIMARY_MODEL,
  formatGrokModelLabel,
} from '@/providers/grok/types/models';

describe('Grok model catalog', () => {
  it('uses the CLI\'s real default model (grok-composer-2.5-fast), not the deprecated grok-build-0.1', () => {
    // `grok models` reports `grok-composer-2.5-fast` as the current default.
    // The old `grok-build-0.1` is no longer served by the CLI and must not be the fallback.
    expect(DEFAULT_GROK_PRIMARY_MODEL).toBe('grok-composer-2.5-fast');
    expect(DEFAULT_GROK_PRIMARY_MODEL).not.toBe('grok-build-0.1');
  });

  it('lists the default model first and only currently-served model ids', () => {
    const values = DEFAULT_GROK_MODELS.map(m => m.value);
    expect(values[0]).toBe('grok-composer-2.5-fast');
    // The deprecated id must not appear as a built-in option.
    expect(values).not.toContain('grok-build-0.1');
    // The build tier (currently served) should be selectable.
    expect(values).toContain('grok-build');
  });

  it('keeps a 256K context window', () => {
    expect(DEFAULT_GROK_CONTEXT_WINDOW).toBe(256_000);
  });

  it('formats model ids into readable labels', () => {
    expect(formatGrokModelLabel('grok-composer-2.5-fast')).toBe('Grok Composer 2.5 Fast');
    expect(formatGrokModelLabel('grok-build')).toBe('Grok Build');
    expect(formatGrokModelLabel('grok-code-fast-1')).toBe('Grok Code Fast 1');
    expect(formatGrokModelLabel('')).toBe('Grok');
  });
});
