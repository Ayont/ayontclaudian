import {
  applyDshDefaultModelToYaml,
  buildDshModelOptionsFromHarness,
  parseDshActiveModel,
  parseDshHarnessProviders,
} from '@/providers/dsh/harnessSettings';

const SAMPLE_YAML = [
  'ui-onboarding:',
  '  welcomeNoticeVersion: 2026-08-13.1',
  'llm-pi-ai:',
  '  providers:',
  '    cline:',
  '      displayName: Cline API',
  '      apiKeyEnv: CLINE_API_KEY',
  '      api: openai-completions',
  '      baseURL: https://api.cline.bot/api/v1',
  '      models:',
  '        - id: cline-pass/kimi-k3',
  '          name: Kimi K3',
  '        - id: cline-pass/deepseek-v4-pro',
  '          name: Deepseek V4 Pro',
  '    openrouter:',
  '      apiKeyEnv: OPENROUTER_API_KEY',
  '      models:',
  '        - id: stealth/ox-alpha',
  '          name: Ox Alpha',
  'agent-default-model:',
  '  provider: openrouter',
  '  model: stealth/ox-alpha',
].join('\n');

describe('dsh harness settings bridge', () => {
  it('extracts every configured model from the harness yaml', () => {
    const providers = parseDshHarnessProviders(SAMPLE_YAML);
    expect(providers.map((p) => p.id)).toEqual(['cline', 'openrouter']);
    expect(providers[0].models).toEqual([
      { id: 'cline-pass/kimi-k3', name: 'Kimi K3' },
      { id: 'cline-pass/deepseek-v4-pro', name: 'Deepseek V4 Pro' },
    ]);
    expect(providers[0].displayName).toBe('Cline API');
  });

  it('reads the active agent-default-model selection', () => {
    expect(parseDshActiveModel(SAMPLE_YAML)).toEqual({ provider: 'openrouter', model: 'stealth/ox-alpha' });
    expect(parseDshActiveModel('nothing: here')).toBeNull();
  });

  it('builds one dropdown option per configured model with stable pipe values', () => {
    const options = buildDshModelOptionsFromHarness(parseDshHarnessProviders(SAMPLE_YAML));
    expect(options.map((o) => o.value)).toEqual([
      'cline|cline-pass/kimi-k3',
      'cline|cline-pass/deepseek-v4-pro',
      'openrouter|stealth/ox-alpha',
    ]);
    expect(options[0].label).toBe('Kimi K3');
    expect(options[0].description).toContain('Cline API');
  });

  it('rewrites only agent-default-model when the user picks another model', () => {
    const next = applyDshDefaultModelToYaml(SAMPLE_YAML, 'cline', 'cline-pass/kimi-k3');
    expect(parseDshActiveModel(next)).toEqual({ provider: 'cline', model: 'cline-pass/kimi-k3' });
    // Everything else survives the round trip.
    const reparsed = parseDshHarnessProviders(next);
    expect(reparsed[0].models).toHaveLength(2);
    expect(next).not.toContain('cline-pass/kimi-k3\n  provider: openrouter');
  });

  it('tolerates malformed yaml without throwing', () => {
    expect(parseDshHarnessProviders(':::broken')).toEqual([]);
    expect(parseDshActiveModel(null)).toBeNull();
  });
});