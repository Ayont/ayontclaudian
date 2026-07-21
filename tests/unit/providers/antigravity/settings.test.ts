import {
  ANTIGRAVITY_AGENT_PRESETS,
  DEFAULT_ANTIGRAVITY_PROVIDER_SETTINGS,
  getAntigravityProviderSettings,
  normalizeAntigravityAgent,
  updateAntigravityProviderSettings,
} from '@/providers/antigravity/settings';

describe('Antigravity settings permissionMode', () => {
  it('defaults to YOLO when nothing is persisted', () => {
    expect(DEFAULT_ANTIGRAVITY_PROVIDER_SETTINGS.permissionMode).toBe('yolo');
    expect(getAntigravityProviderSettings({}).permissionMode).toBe('yolo');
  });

  it('reads an explicit permissionMode of "sandbox"', () => {
    const settings = { providerConfigs: { antigravity: { permissionMode: 'sandbox' } } };
    expect(getAntigravityProviderSettings(settings).permissionMode).toBe('sandbox');
  });

  it('migrates legacy sandbox:true to permissionMode "sandbox"', () => {
    const settings = { providerConfigs: { antigravity: { sandbox: true } } };
    expect(getAntigravityProviderSettings(settings).permissionMode).toBe('sandbox');
  });

  it('migrates legacy sandbox:false to permissionMode "yolo"', () => {
    const settings = { providerConfigs: { antigravity: { sandbox: false } } };
    expect(getAntigravityProviderSettings(settings).permissionMode).toBe('yolo');
  });

  it('prefers an explicit permissionMode over a conflicting legacy sandbox flag', () => {
    const settings = {
      providerConfigs: { antigravity: { permissionMode: 'yolo', sandbox: true } },
    };
    expect(getAntigravityProviderSettings(settings).permissionMode).toBe('yolo');
  });

  it('falls back to YOLO for an unknown permissionMode value', () => {
    const settings = { providerConfigs: { antigravity: { permissionMode: 'bogus' } } };
    expect(getAntigravityProviderSettings(settings).permissionMode).toBe('yolo');
  });

  it('persists permissionMode and drops the legacy sandbox boolean on write', () => {
    const settings: Record<string, unknown> = {
      providerConfigs: { antigravity: { sandbox: true } },
    };

    updateAntigravityProviderSettings(settings, { permissionMode: 'sandbox' });

    const stored = (settings.providerConfigs as Record<string, Record<string, unknown>>).antigravity;
    expect(stored.permissionMode).toBe('sandbox');
    expect('sandbox' in stored).toBe(false);
    expect(getAntigravityProviderSettings(settings).permissionMode).toBe('sandbox');
  });

  it('round-trips a switch back to YOLO without leaking a sandbox field', () => {
    const settings: Record<string, unknown> = {
      providerConfigs: { antigravity: { permissionMode: 'sandbox' } },
    };

    updateAntigravityProviderSettings(settings, { permissionMode: 'yolo' });

    const stored = (settings.providerConfigs as Record<string, Record<string, unknown>>).antigravity;
    expect(stored.permissionMode).toBe('yolo');
    expect('sandbox' in stored).toBe(false);
  });

  it('normalizes an invalid permissionMode update to YOLO', () => {
    const settings: Record<string, unknown> = { providerConfigs: { antigravity: {} } };
    updateAntigravityProviderSettings(settings, {
      permissionMode: 'nonsense' as 'yolo',
    });
    expect(getAntigravityProviderSettings(settings).permissionMode).toBe('yolo');
  });
});

// Regression: verified live against `agy agents` (agy 1.1.4) — the builtin
// persona picker (`--agent`, agy >= 1.1.1) must stay selectable and safe.
describe('Antigravity settings agent', () => {
  it('defaults to "default" (no --agent flag) when nothing is persisted', () => {
    expect(DEFAULT_ANTIGRAVITY_PROVIDER_SETTINGS.agent).toBe('default');
    expect(getAntigravityProviderSettings({}).agent).toBe('default');
  });

  it('includes every builtin persona confirmed via `agy agents`', () => {
    expect(ANTIGRAVITY_AGENT_PRESETS).toEqual(
      expect.arrayContaining([
        'architect',
        'coder',
        'debugger',
        'security_engineer',
        'code-reviewer',
        'code_reviewer',
        'ux_designer',
      ]),
    );
    // Both the hyphenated and underscored code-reviewer variants exist in
    // `agy agents` output and must both stay selectable.
    expect(ANTIGRAVITY_AGENT_PRESETS.length).toBe(23);
  });

  it('reads a known persona from persisted config', () => {
    const settings = { providerConfigs: { antigravity: { agent: 'architect' } } };
    expect(getAntigravityProviderSettings(settings).agent).toBe('architect');
  });

  it('falls back to "default" for an unknown persona value', () => {
    const settings = { providerConfigs: { antigravity: { agent: 'not-a-real-agent' } } };
    expect(getAntigravityProviderSettings(settings).agent).toBe('default');
  });

  it('normalizeAntigravityAgent rejects non-string and unknown values', () => {
    expect(normalizeAntigravityAgent(undefined)).toBe('default');
    expect(normalizeAntigravityAgent(null)).toBe('default');
    expect(normalizeAntigravityAgent(42)).toBe('default');
    expect(normalizeAntigravityAgent('coder')).toBe('coder');
  });

  it('persists an explicit agent update', () => {
    const settings: Record<string, unknown> = { providerConfigs: { antigravity: {} } };
    updateAntigravityProviderSettings(settings, { agent: 'security_engineer' });
    expect(getAntigravityProviderSettings(settings).agent).toBe('security_engineer');
  });
});
