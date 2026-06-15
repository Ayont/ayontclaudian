import { getAntigravityProviderSettings } from '@/providers/antigravity/settings';
import { antigravityChatUIConfig } from '@/providers/antigravity/ui/AntigravityChatUIConfig';

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
});
