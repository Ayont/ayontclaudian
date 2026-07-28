import { getAntigravityProviderSettings } from '@/providers/antigravity/settings';
import {
  ANTIGRAVITY_DEFAULT_MODEL_ID,
  ANTIGRAVITY_MODEL_NAMES,
  antigravityChatUIConfig,
  isAntigravityModelName,
} from '@/providers/antigravity/ui/AntigravityChatUIConfig';

describe('AntigravityChatUIConfig models', () => {
  it('offers a Default entry plus every agy model', () => {
    const options = antigravityChatUIConfig.getModelOptions({});
    expect(options[0].value).toBe(ANTIGRAVITY_DEFAULT_MODEL_ID);
    expect(options).toHaveLength(ANTIGRAVITY_MODEL_NAMES.length + 1);
    for (const name of ANTIGRAVITY_MODEL_NAMES) {
      expect(options.some((o) => o.value === name)).toBe(true);
    }
  });

  it('includes the requested non-Flash models', () => {
    expect(ANTIGRAVITY_MODEL_NAMES).toEqual(
      expect.arrayContaining([
        'Gemini 3.1 Pro (High)',
        'Claude Sonnet 4.6 (Thinking)',
        'Claude Opus 4.6 (Thinking)',
        'GPT-OSS 120B (Medium)',
      ]),
    );
  });

  // Regression: verified live against `agy models` (agy 1.1.4) — Gemini 3.6
  // Flash shipped alongside 3.5 Flash and must stay selectable.
  it('includes all three Gemini 3.6 Flash reasoning tiers', () => {
    expect(ANTIGRAVITY_MODEL_NAMES).toEqual(
      expect.arrayContaining([
        'Gemini 3.6 Flash (Low)',
        'Gemini 3.6 Flash (Medium)',
        'Gemini 3.6 Flash (High)',
      ]),
    );
  });

  it('owns the default id and every model name', () => {
    expect(antigravityChatUIConfig.ownsModel(ANTIGRAVITY_DEFAULT_MODEL_ID, {})).toBe(true);
    expect(antigravityChatUIConfig.ownsModel('Gemini 3.1 Pro (High)', {})).toBe(true);
    expect(antigravityChatUIConfig.ownsModel('not-a-model', {})).toBe(false);
  });

  it('isDefaultModel only for the synthetic default', () => {
    expect(antigravityChatUIConfig.isDefaultModel(ANTIGRAVITY_DEFAULT_MODEL_ID)).toBe(true);
    expect(antigravityChatUIConfig.isDefaultModel('Gemini 3.5 Flash (High)')).toBe(false);
  });

  it('normalizeModelVariant keeps a known model and falls back otherwise', () => {
    expect(antigravityChatUIConfig.normalizeModelVariant('Gemini 3.1 Pro (Low)', {})).toBe('Gemini 3.1 Pro (Low)');
    expect(antigravityChatUIConfig.normalizeModelVariant('bogus', {})).toBe(ANTIGRAVITY_DEFAULT_MODEL_ID);
  });

  it('isAntigravityModelName distinguishes real models from the default', () => {
    expect(isAntigravityModelName('Claude Opus 4.6 (Thinking)')).toBe(true);
    expect(isAntigravityModelName(ANTIGRAVITY_DEFAULT_MODEL_ID)).toBe(false);
  });
});

describe('AntigravityChatUIConfig permission mode', () => {
  describe('getPermissionModeToggle', () => {
    it('exposes a two-state YOLO <-> Sandbox toggle with no plan mode', () => {
      const toggle = antigravityChatUIConfig.getPermissionModeToggle!();
      expect(toggle).toEqual({
        inactiveValue: 'sandbox',
        inactiveLabel: 'Sandbox',
        activeValue: 'yolo',
        activeLabel: 'YOLO',
      });
      // agy has no plan mode: planValue/planLabel must be absent.
      expect(toggle!.planValue).toBeUndefined();
      expect(toggle!.planLabel).toBeUndefined();
    });
  });

  describe('resolvePermissionMode', () => {
    it('defaults to "yolo" when nothing is persisted', () => {
      expect(antigravityChatUIConfig.resolvePermissionMode!({})).toBe('yolo');
    });

    it('reflects the persisted sandbox posture', () => {
      const settings = { providerConfigs: { antigravity: { permissionMode: 'sandbox' } } };
      expect(antigravityChatUIConfig.resolvePermissionMode!(settings)).toBe('sandbox');
    });
  });

  describe('applyPermissionMode', () => {
    it('persists "sandbox" and mirrors it onto the settings bag', () => {
      const settings: Record<string, unknown> = { providerConfigs: { antigravity: {} } };
      antigravityChatUIConfig.applyPermissionMode!('sandbox', settings);
      expect(settings.permissionMode).toBe('sandbox');
      expect(getAntigravityProviderSettings(settings).permissionMode).toBe('sandbox');
    });

    it('treats any non-sandbox value as "yolo"', () => {
      const settings: Record<string, unknown> = {
        providerConfigs: { antigravity: { permissionMode: 'sandbox' } },
      };
      antigravityChatUIConfig.applyPermissionMode!('yolo', settings);
      expect(getAntigravityProviderSettings(settings).permissionMode).toBe('yolo');

      antigravityChatUIConfig.applyPermissionMode!('garbage', settings);
      expect(getAntigravityProviderSettings(settings).permissionMode).toBe('yolo');
    });

    it('ignores non-object settings without throwing', () => {
      expect(() => antigravityChatUIConfig.applyPermissionMode!('sandbox', null)).not.toThrow();
    });
  });

  // Regression: getContextWindowSize() took no model argument and returned a flat
  // 1M for every entry, but the agy model list deliberately spans three vendors.
  // GPT-OSS 120B is 131K, so at ~120K tokens the badge read 12% full instead of
  // ~92% — and agy reports no token counts, so nothing ever corrected it.
  describe('getContextWindowSize', () => {
    it('returns the GPT-OSS window, not the 1M default', () => {
      expect(antigravityChatUIConfig.getContextWindowSize('GPT-OSS 120B (Medium)', undefined)).toBe(131_072);
    });

    it('returns 1M for the Gemini and Claude entries', () => {
      expect(antigravityChatUIConfig.getContextWindowSize('Gemini 3.6 Flash (High)', undefined)).toBe(1_000_000);
      expect(antigravityChatUIConfig.getContextWindowSize('Gemini 3.1 Pro (Low)', undefined)).toBe(1_000_000);
      expect(antigravityChatUIConfig.getContextWindowSize('Claude Sonnet 4.6 (Thinking)', undefined)).toBe(1_000_000);
      expect(antigravityChatUIConfig.getContextWindowSize('Claude Opus 4.6 (Thinking)', undefined)).toBe(1_000_000);
    });

    it('matches on name prefix so every reasoning-level suffix is covered', () => {
      for (const level of ['(Low)', '(Medium)', '(High)']) {
        expect(antigravityChatUIConfig.getContextWindowSize(`GPT-OSS 120B ${level}`, undefined)).toBe(131_072);
      }
    });

    it('falls back to 1M for the synthetic default and unknown names', () => {
      expect(antigravityChatUIConfig.getContextWindowSize(ANTIGRAVITY_DEFAULT_MODEL_ID, undefined)).toBe(1_000_000);
      expect(antigravityChatUIConfig.getContextWindowSize('', undefined)).toBe(1_000_000);
      expect(antigravityChatUIConfig.getContextWindowSize('Some Future Model (High)', undefined)).toBe(1_000_000);
    });

    it('prefers a user-configured custom limit', () => {
      expect(
        antigravityChatUIConfig.getContextWindowSize('GPT-OSS 120B (Medium)', { 'GPT-OSS 120B (Medium)': 64_000 }),
      ).toBe(64_000);
    });
  });

});
