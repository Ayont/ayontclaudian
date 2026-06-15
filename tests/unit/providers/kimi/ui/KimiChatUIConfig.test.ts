import { getKimiProviderSettings } from '@/providers/kimi/settings';
import { kimiChatUIConfig } from '@/providers/kimi/ui/KimiChatUIConfig';

describe('KimiChatUIConfig permission mode', () => {
  describe('getPermissionModeToggle', () => {
    it('exposes a Safe / YOLO / Plan toggle', () => {
      const toggle = kimiChatUIConfig.getPermissionModeToggle!();
      expect(toggle).toEqual({
        inactiveValue: 'normal',
        inactiveLabel: 'Safe',
        activeValue: 'yolo',
        activeLabel: 'YOLO',
        planValue: 'plan',
        planLabel: 'Plan',
      });
    });
  });

  describe('resolvePermissionMode', () => {
    it('defaults to "normal" when nothing is persisted', () => {
      expect(kimiChatUIConfig.resolvePermissionMode!({})).toBe('normal');
    });

    it('reflects persisted yolo and plan postures', () => {
      expect(
        kimiChatUIConfig.resolvePermissionMode!({ providerConfigs: { kimi: { permissionMode: 'yolo' } } }),
      ).toBe('yolo');
      expect(
        kimiChatUIConfig.resolvePermissionMode!({ providerConfigs: { kimi: { permissionMode: 'plan' } } }),
      ).toBe('plan');
    });
  });

  describe('applyPermissionMode', () => {
    it('persists yolo / plan and falls back to normal for unknown values', () => {
      const settings: Record<string, unknown> = { providerConfigs: { kimi: {} } };

      kimiChatUIConfig.applyPermissionMode!('yolo', settings);
      expect(settings.permissionMode).toBe('yolo');
      expect(getKimiProviderSettings(settings).permissionMode).toBe('yolo');

      kimiChatUIConfig.applyPermissionMode!('plan', settings);
      expect(getKimiProviderSettings(settings).permissionMode).toBe('plan');

      kimiChatUIConfig.applyPermissionMode!('bogus', settings);
      expect(getKimiProviderSettings(settings).permissionMode).toBe('normal');
    });
  });

  describe('getModeSelector (agent) stays separate from the permission toggle', () => {
    it('returns the Agent selector with default/okabe options', () => {
      const selector = kimiChatUIConfig.getModeSelector!({ providerConfigs: { kimi: {} } });
      expect(selector).not.toBeNull();
      expect(selector!.label).toBe('Agent');
      expect(selector!.options).toEqual([
        { value: 'default', label: 'Default' },
        { value: 'okabe', label: 'Okabe' },
      ]);
      expect(selector!.value).toBe('default');
    });

    it('applies the agent selection without disturbing permissionMode', () => {
      const settings: Record<string, unknown> = {
        providerConfigs: { kimi: { permissionMode: 'yolo' } },
      };
      kimiChatUIConfig.applyModeSelection!('okabe', settings);
      expect(getKimiProviderSettings(settings).agent).toBe('okabe');
      expect(getKimiProviderSettings(settings).permissionMode).toBe('yolo');
    });
  });
});
