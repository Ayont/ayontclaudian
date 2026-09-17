/**
 * Oh My Pi session modes.
 *
 * Verified against `omp acp` v18.2.3: `session/new` returns them as an ACP
 * config option (`id: "mode"`, `category: "mode"`) with exactly two entries —
 * `default` and `plan`.
 *
 * Unlike Opencode, Claudian does NOT synthesize modes here. Opencode needs
 * generated `claudian-yolo` / `claudian-safe` agent definitions because its
 * permission ladder lives in agent config; Oh My Pi gates every write through
 * an ACP permission request instead, so the agent's own two modes are the whole
 * set. "Managed" therefore means "the agent's real modes" for this provider.
 */

export interface OmpMode {
  description?: string;
  id: string;
  name: string;
}

export const OMP_DEFAULT_MODE_ID = 'default';
export const OMP_PLAN_MODE_ID = 'plan';

export const OMP_FALLBACK_MODES: ReadonlyArray<OmpMode> = Object.freeze([
  {
    description: 'Standardmodus mit vollem Werkzeugzugriff.',
    id: OMP_DEFAULT_MODE_ID,
    name: 'Default',
  },
  {
    description: 'Nur-Lesen-Planung: schreibt erst einen Plan als Markdown, bevor Code geändert wird.',
    id: OMP_PLAN_MODE_ID,
    name: 'Plan',
  },
]);

const OMP_MANAGED_MODE_IDS = new Set(OMP_FALLBACK_MODES.map((mode) => mode.id));

export function normalizeOmpAvailableModes(value: unknown): OmpMode[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized: OmpMode[] = [];
  const seen = new Set<string>();
  for (const entry of value as unknown[]) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      continue;
    }
    const record = entry as Record<string, unknown>;

    const id = typeof record.id === 'string' ? record.id.trim() : '';
    const name = typeof record.name === 'string' ? record.name.trim() : id;
    const description = typeof record.description === 'string'
      ? record.description.trim()
      : '';

    if (!id || seen.has(id)) {
      continue;
    }

    seen.add(id);
    normalized.push({
      ...(description ? { description } : {}),
      id,
      name: name || id,
    });
  }

  return normalized;
}

export function getEffectiveOmpModes(modes: OmpMode[]): OmpMode[] {
  return modes.length > 0 ? modes : [...OMP_FALLBACK_MODES];
}

export function isManagedOmpModeId(value: string): boolean {
  return OMP_MANAGED_MODE_IDS.has(value);
}

/**
 * Whatever the agent reported, narrowed to the modes Claudian knows how to map
 * onto a permission posture. An unknown mode is dropped rather than shown,
 * because the toolbar would have no posture to display for it.
 */
export function getManagedOmpModes(modes: OmpMode[]): OmpMode[] {
  const effectiveModes = getEffectiveOmpModes(modes);
  return OMP_FALLBACK_MODES.map((fallbackMode) => (
    effectiveModes.find((mode) => mode.id === fallbackMode.id) ?? fallbackMode
  ));
}

export function normalizeOmpSelectedMode(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}

export function normalizeManagedOmpSelectedMode(
  value: unknown,
  modes: OmpMode[] = [],
): string {
  const normalized = normalizeOmpSelectedMode(value);
  if (!normalized) {
    return '';
  }

  const managedModes = getManagedOmpModes(modes);
  return managedModes.some((mode) => mode.id === normalized)
    ? normalized
    : (managedModes[0]?.id ?? '');
}

/**
 * Oh My Pi has no graded edit-approval ladder — only `plan` (read-only) and
 * `default` (full tools). Both `normal` and `yolo` therefore run in `default`;
 * the difference between them is how Claudian answers the ACP permission
 * requests, not which mode the session is in.
 */
export function resolveOmpModeForPermissionMode(
  permissionMode: unknown,
  modes: OmpMode[] = [],
): string {
  const managedModes = getManagedOmpModes(modes);
  const managedModeIds = new Set(managedModes.map((mode) => mode.id));

  if (permissionMode === 'plan' && managedModeIds.has(OMP_PLAN_MODE_ID)) {
    return OMP_PLAN_MODE_ID;
  }
  if (managedModeIds.has(OMP_DEFAULT_MODE_ID)) {
    return OMP_DEFAULT_MODE_ID;
  }

  return managedModes[0]?.id ?? '';
}

export function resolvePermissionModeForManagedOmpMode(
  modeId: unknown,
): 'normal' | 'plan' | 'yolo' | null {
  if (modeId === OMP_PLAN_MODE_ID) {
    return 'plan';
  }
  if (modeId === OMP_DEFAULT_MODE_ID) {
    return 'normal';
  }
  return null;
}
