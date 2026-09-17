import {
  getManagedOmpModes,
  isManagedOmpModeId,
  normalizeManagedOmpSelectedMode,
  normalizeOmpAvailableModes,
  OMP_DEFAULT_MODE_ID,
  OMP_PLAN_MODE_ID,
  resolveOmpModeForPermissionMode,
  resolvePermissionModeForManagedOmpMode,
} from '@/providers/omp/modes';

/**
 * Mirrors the real `session/new` → `configOptions[category="mode"].options`
 * payload from omp v18.2.3, already flattened by the shared ACP layer.
 */
const AGENT_REPORTED_MODES = [
  { id: 'default', name: 'Default', description: 'Standard ACP headless mode' },
  { id: 'plan', name: 'Plan', description: 'Read-only planning mode that drafts a plan to a markdown file before any code changes' },
];

describe('omp modes', () => {
  it('exposes exactly the two modes the agent actually has', () => {
    expect(getManagedOmpModes(AGENT_REPORTED_MODES).map((mode) => mode.id))
      .toEqual([OMP_DEFAULT_MODE_ID, OMP_PLAN_MODE_ID]);
  });

  it('does not claim Opencode-style permission agents', () => {
    expect(isManagedOmpModeId('claudian-yolo')).toBe(false);
    expect(isManagedOmpModeId('claudian-safe')).toBe(false);
    expect(isManagedOmpModeId('build')).toBe(false);
  });

  it('normalizes the agent payload, dropping entries without an id', () => {
    const normalized = normalizeOmpAvailableModes([
      ...AGENT_REPORTED_MODES,
      { name: 'Broken' },
      { id: 'plan', name: 'Duplicate' },
    ]);

    expect(normalized.map((mode) => mode.id)).toEqual(['default', 'plan']);
  });

  it('routes plan posture to plan mode and every executing posture to default', () => {
    expect(resolveOmpModeForPermissionMode('plan', AGENT_REPORTED_MODES)).toBe(OMP_PLAN_MODE_ID);
    expect(resolveOmpModeForPermissionMode('normal', AGENT_REPORTED_MODES)).toBe(OMP_DEFAULT_MODE_ID);
    expect(resolveOmpModeForPermissionMode('yolo', AGENT_REPORTED_MODES)).toBe(OMP_DEFAULT_MODE_ID);
  });

  it('falls back to the known mode set when the agent reported none', () => {
    expect(resolveOmpModeForPermissionMode('plan', [])).toBe(OMP_PLAN_MODE_ID);
    expect(resolveOmpModeForPermissionMode('normal', [])).toBe(OMP_DEFAULT_MODE_ID);
  });

  it('maps a mode id back to a permission posture', () => {
    expect(resolvePermissionModeForManagedOmpMode(OMP_PLAN_MODE_ID)).toBe('plan');
    expect(resolvePermissionModeForManagedOmpMode(OMP_DEFAULT_MODE_ID)).toBe('normal');
    expect(resolvePermissionModeForManagedOmpMode('something-else')).toBeNull();
  });

  it('coerces an unknown persisted mode back to a real one', () => {
    expect(normalizeManagedOmpSelectedMode('claudian-yolo', AGENT_REPORTED_MODES))
      .toBe(OMP_DEFAULT_MODE_ID);
    expect(normalizeManagedOmpSelectedMode('plan', AGENT_REPORTED_MODES))
      .toBe(OMP_PLAN_MODE_ID);
    expect(normalizeManagedOmpSelectedMode('', AGENT_REPORTED_MODES)).toBe('');
  });
});
