import { getGrokProviderSettings, updateGrokProviderSettings } from '@/providers/grok/settings';

/**
 * The bot a Grok tab runs as. Stored by NAME, because that is what
 * `grok --agent <NAME>` takes and what `grok inspect --json` reports; an empty
 * value means the CLI's own default agent.
 *
 * The previous `agent: 'default' | 'okabe'` pair was guessed and matched
 * nothing the CLI actually offers, so it never reached a launch.
 */
describe('Grok bot selection', () => {
  it('normalizes writes without clearing a bot during unrelated updates', () => {
    const settings: Record<string, unknown> = {};
    const saved = updateGrokProviderSettings(settings, { botName: '  explore  ' });
    expect(saved.botName).toBe('explore');
    expect((settings.providerConfigs as { grok: { botName: string } }).grok.botName).toBe('explore');
    updateGrokProviderSettings(settings, { customModels: 'custom' });
    expect(getGrokProviderSettings(settings).botName).toBe('explore');
  });
  it('defaults to the CLI default agent', () => {
    expect(getGrokProviderSettings({}).botName).toBe('');
  });

  it('round-trips a selected bot', () => {
    const settings: Record<string, unknown> = {};

    updateGrokProviderSettings(settings, { botName: 'explore' });

    expect(getGrokProviderSettings(settings).botName).toBe('explore');
  });

  it('trims a hand-edited value so the flag never carries whitespace', () => {
    const settings: Record<string, unknown> = {
      providerConfigs: { grok: { botName: '  seo-content  ' } },
    };

    expect(getGrokProviderSettings(settings).botName).toBe('seo-content');
  });

  it('treats a non-string as no selection rather than crashing a turn', () => {
    const settings: Record<string, unknown> = {
      providerConfigs: { grok: { botName: 42 } },
    };

    expect(getGrokProviderSettings(settings).botName).toBe('');
  });

  it('clears back to the default agent', () => {
    const settings: Record<string, unknown> = {};
    updateGrokProviderSettings(settings, { botName: 'plan' });

    updateGrokProviderSettings(settings, { botName: '' });

    expect(getGrokProviderSettings(settings).botName).toBe('');
  });
});
