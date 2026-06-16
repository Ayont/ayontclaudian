import { formatStatusTooltip, readyWord } from '@/features/chat/ui/ProviderStatusBar';

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

describe('formatStatusTooltip', () => {
  it('includes name + state + context percent', () => {
    expect(
      formatStatusTooltip({
        providerId: 'kimi', name: 'Kimi', ready: true, enabled: true,
        percentage: 42, estimated: true,
      }),
    ).toBe('Kimi: bereit · Kontext ≈42% belegt');
  });

  it('hints at CLI setup when enabled but not ready', () => {
    expect(
      formatStatusTooltip({
        providerId: 'codex', name: 'Codex', ready: false, enabled: true,
        percentage: null, estimated: false,
      }),
    ).toBe('Codex: Setup nötig · CLI nicht gefunden — Pfad/Login in den Einstellungen prüfen');
  });

  it('omits the percent when unknown', () => {
    expect(
      formatStatusTooltip({
        providerId: 'claude', name: 'Claude', ready: true, enabled: true,
        percentage: null, estimated: false,
      }),
    ).toBe('Claude: bereit');
  });
});
