import { formatStatusTooltip, readyWord, stateWord } from '@/features/chat/ui/ProviderStatusBar';

describe('readyWord', () => {
  it('is "aus" when disabled', () => {
    expect(readyWord({ ready: false, enabled: false })).toBe('aus');
    expect(readyWord({ ready: true, enabled: false })).toBe('aus');
  });

  it('is "bereit" when enabled and ready', () => {
    expect(readyWord({ ready: true, enabled: true })).toBe('bereit');
  });

  it('is "Setup nötig" when enabled but the CLI did not resolve', () => {
    expect(readyWord({ ready: false, enabled: true })).toBe('Setup nötig');
  });
});

describe('stateWord', () => {
  it('is "generiert…" while streaming, regardless of ready/enabled', () => {
    expect(stateWord({ ready: false, enabled: false, streaming: true })).toBe('generiert…');
    expect(stateWord({ ready: true, enabled: true, streaming: true })).toBe('generiert…');
  });

  it('falls back to the ready word when not streaming', () => {
    expect(stateWord({ ready: true, enabled: true, streaming: false })).toBe('bereit');
    expect(stateWord({ ready: false, enabled: true, streaming: false })).toBe('Setup nötig');
  });
});

describe('formatStatusTooltip', () => {
  it('includes name + state + context percent', () => {
    expect(
      formatStatusTooltip({
        providerId: 'kimi', name: 'Kimi', ready: true, enabled: true, streaming: false,
        percentage: 42, estimated: true,
      }),
    ).toBe('Kimi: bereit · Kontext ≈42% belegt');
  });

  it('shows the generating state while streaming', () => {
    expect(
      formatStatusTooltip({
        providerId: 'claude', name: 'Claude', ready: true, enabled: true, streaming: true,
        percentage: 12, estimated: false,
      }),
    ).toBe('Claude: generiert… · Kontext 12% belegt');
  });

  it('appends the auto-mode marker when active', () => {
    expect(
      formatStatusTooltip({
        providerId: 'claude', name: 'Claude', ready: true, enabled: true, streaming: false,
        percentage: null, estimated: false, autoMode: true,
      }),
    ).toBe('Claude: bereit · Auto-Mode aktiv');
  });

  it('hints at CLI setup when enabled but not ready', () => {
    expect(
      formatStatusTooltip({
        providerId: 'codex', name: 'Codex', ready: false, enabled: true, streaming: false,
        percentage: null, estimated: false,
      }),
    ).toBe('Codex: Setup nötig · CLI nicht gefunden — Pfad/Login in den Einstellungen prüfen');
  });

  it('omits the CLI hint while streaming even if not ready', () => {
    expect(
      formatStatusTooltip({
        providerId: 'codex', name: 'Codex', ready: false, enabled: true, streaming: true,
        percentage: null, estimated: false,
      }),
    ).toBe('Codex: generiert…');
  });

  it('omits the percent when unknown', () => {
    expect(
      formatStatusTooltip({
        providerId: 'claude', name: 'Claude', ready: true, enabled: true, streaming: false,
        percentage: null, estimated: false,
      }),
    ).toBe('Claude: bereit');
  });
});
