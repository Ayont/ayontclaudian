import { OMP_DEFAULT_MODE_ID, OMP_PLAN_MODE_ID } from '@/providers/omp/modes';
import { getOmpProviderSettings } from '@/providers/omp/settings';
import { ompChatUIConfig } from '@/providers/omp/ui/OmpChatUIConfig';

/**
 * Oh My Pi has only two ACP modes (`default`, `plan`), so the executing
 * postures `normal` and `yolo` BOTH run in `default`. The difference between
 * them is not the session mode — it is whether Claudian answers omp's ACP
 * permission requests itself. Deriving the toggle state from the mode alone
 * therefore loses `yolo` and makes the toggle snap back to Safe.
 */
describe('OMP permission mode round-trip', () => {
  function applyAndRead(value: string): string | null {
    const bag: Record<string, unknown> = {};
    ompChatUIConfig.applyPermissionMode?.(value, bag);
    return ompChatUIConfig.resolvePermissionMode?.(bag) ?? null;
  }

  it('keeps YOLO selected after it is applied', () => {
    expect(applyAndRead('yolo')).toBe('yolo');
  });

  it('keeps Safe selected after it is applied', () => {
    expect(applyAndRead('normal')).toBe('normal');
  });

  it('keeps Plan selected after it is applied', () => {
    expect(applyAndRead('plan')).toBe('plan');
  });

  it('still drives the real ACP session mode underneath', () => {
    const bag: Record<string, unknown> = {};

    ompChatUIConfig.applyPermissionMode?.('yolo', bag);
    expect(getOmpProviderSettings(bag).selectedMode).toBe(OMP_DEFAULT_MODE_ID);

    ompChatUIConfig.applyPermissionMode?.('plan', bag);
    expect(getOmpProviderSettings(bag).selectedMode).toBe(OMP_PLAN_MODE_ID);
  });

  it('reports plan from the session mode even without a stored posture', () => {
    // A session whose mode was changed by omp itself (e.g. /mode plan) has no
    // Claudian-applied posture to read back.
    const bag: Record<string, unknown> = {};
    ompChatUIConfig.applyPermissionMode?.('plan', bag);
    delete (bag as { permissionMode?: unknown }).permissionMode;

    expect(ompChatUIConfig.resolvePermissionMode?.(bag)).toBe('plan');
  });
});
