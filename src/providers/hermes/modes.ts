/**
 * Hermes session modes.
 *
 * Hermes maps its edit-approval policy onto ACP modes (rather than config
 * options) so editors keep a separate model picker — see
 * `acp_adapter/server.py::_session_modes`. The three ids below are the ones the
 * ACP server actually accepts; anything else is coerced back to `default`.
 */

import type { PermissionMode } from '../../core/types/settings';

export interface HermesMode {
  description?: string;
  id: string;
  name: string;
}

export const HERMES_DEFAULT_MODE_ID = 'default';
export const HERMES_ACCEPT_EDITS_MODE_ID = 'accept_edits';
export const HERMES_DONT_ASK_MODE_ID = 'dont_ask';

export const HERMES_FALLBACK_MODES: ReadonlyArray<HermesMode> = Object.freeze([
  {
    description: 'Fragt vor Datei-Änderungen nach.',
    id: HERMES_DEFAULT_MODE_ID,
    name: 'Default',
  },
  {
    description: 'Erlaubt Änderungen im Workspace automatisch, fragt bei sensiblen Pfaden.',
    id: HERMES_ACCEPT_EDITS_MODE_ID,
    name: 'Accept Edits',
  },
  {
    description: 'Erlaubt Datei-Änderungen für diese Sitzung ohne Rückfrage (außer sensible Pfade).',
    id: HERMES_DONT_ASK_MODE_ID,
    name: "Don't Ask",
  },
]);

const HERMES_MODE_IDS = new Set(HERMES_FALLBACK_MODES.map((mode) => mode.id));

export function normalizeHermesAvailableModes(value: unknown): HermesMode[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized: HermesMode[] = [];
  const seen = new Set<string>();
  for (const entry of value as unknown[]) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      continue;
    }

    const record = entry as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id.trim() : '';
    if (!id || seen.has(id)) {
      continue;
    }

    const name = typeof record.name === 'string' ? record.name.trim() : '';
    const description = typeof record.description === 'string' ? record.description.trim() : '';

    seen.add(id);
    normalized.push({
      ...(description ? { description } : {}),
      id,
      name: name || id,
    });
  }

  return normalized;
}

export function getEffectiveHermesModes(modes: HermesMode[]): HermesMode[] {
  return modes.length > 0 ? modes : [...HERMES_FALLBACK_MODES];
}

export function isKnownHermesModeId(value: string): boolean {
  return HERMES_MODE_IDS.has(value);
}

export function normalizeHermesSelectedMode(value: unknown, modes: HermesMode[] = []): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) {
    return HERMES_DEFAULT_MODE_ID;
  }

  const effectiveModes = getEffectiveHermesModes(modes);
  return effectiveModes.some((mode) => mode.id === trimmed)
    ? trimmed
    : HERMES_DEFAULT_MODE_ID;
}

/**
 * Hermes has no plan mode, so `plan` falls back to the most cautious real mode
 * instead of silently pretending the session is read-only.
 */
export function resolveHermesModeForPermissionMode(
  permissionMode: unknown,
  modes: HermesMode[] = [],
): string {
  const availableIds = new Set(getEffectiveHermesModes(modes).map((mode) => mode.id));

  if (permissionMode === 'yolo' && availableIds.has(HERMES_DONT_ASK_MODE_ID)) {
    return HERMES_DONT_ASK_MODE_ID;
  }
  return HERMES_DEFAULT_MODE_ID;
}

export function resolvePermissionModeForHermesMode(modeId: unknown): PermissionMode | null {
  if (modeId === HERMES_DONT_ASK_MODE_ID) {
    return 'yolo';
  }
  if (modeId === HERMES_DEFAULT_MODE_ID || modeId === HERMES_ACCEPT_EDITS_MODE_ID) {
    return 'normal';
  }
  return null;
}
