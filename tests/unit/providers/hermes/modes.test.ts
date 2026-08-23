import {
  getEffectiveHermesModes,
  HERMES_ACCEPT_EDITS_MODE_ID,
  HERMES_DEFAULT_MODE_ID,
  HERMES_DONT_ASK_MODE_ID,
  isKnownHermesModeId,
  normalizeHermesAvailableModes,
  normalizeHermesSelectedMode,
  resolveHermesModeForPermissionMode,
  resolvePermissionModeForHermesMode,
} from '@/providers/hermes/modes';

// The three ids Hermes' ACP server actually accepts (acp_adapter/server.py).
const DISCOVERED_MODES = [
  { description: 'Ask before edits.', id: 'default', name: 'Default' },
  { description: 'Auto-allow workspace edits.', id: 'accept_edits', name: 'Accept Edits' },
  { description: 'Auto-allow file edits.', id: 'dont_ask', name: "Don't Ask" },
];

describe('normalizeHermesAvailableModes', () => {
  it('keeps the wire order and drops duplicates and id-less entries', () => {
    expect(normalizeHermesAvailableModes([
      ...DISCOVERED_MODES,
      { id: 'default', name: 'Duplicate' },
      { name: 'No id' },
      null,
    ]).map((mode) => mode.id)).toEqual(['default', 'accept_edits', 'dont_ask']);
  });

  it('falls back to the built-in list when the agent sends nothing', () => {
    expect(normalizeHermesAvailableModes(undefined)).toEqual([]);
    expect(getEffectiveHermesModes([]).map((mode) => mode.id)).toEqual([
      HERMES_DEFAULT_MODE_ID,
      HERMES_ACCEPT_EDITS_MODE_ID,
      HERMES_DONT_ASK_MODE_ID,
    ]);
  });
});

describe('normalizeHermesSelectedMode', () => {
  it('keeps a discovered mode', () => {
    expect(normalizeHermesSelectedMode('dont_ask', DISCOVERED_MODES)).toBe('dont_ask');
  });

  it('coerces an unknown or empty mode back to default', () => {
    expect(normalizeHermesSelectedMode('plan', DISCOVERED_MODES)).toBe(HERMES_DEFAULT_MODE_ID);
    expect(normalizeHermesSelectedMode('', DISCOVERED_MODES)).toBe(HERMES_DEFAULT_MODE_ID);
    expect(normalizeHermesSelectedMode(undefined)).toBe(HERMES_DEFAULT_MODE_ID);
  });
});

describe('permission mode mapping', () => {
  it('maps yolo onto the only mode that skips edit approvals', () => {
    expect(resolveHermesModeForPermissionMode('yolo', DISCOVERED_MODES)).toBe(HERMES_DONT_ASK_MODE_ID);
  });

  it('falls back to default for plan, which Hermes does not implement', () => {
    expect(resolveHermesModeForPermissionMode('plan', DISCOVERED_MODES)).toBe(HERMES_DEFAULT_MODE_ID);
    expect(resolveHermesModeForPermissionMode('normal', DISCOVERED_MODES)).toBe(HERMES_DEFAULT_MODE_ID);
  });

  it('reports the shared permission mode for each Hermes mode', () => {
    expect(resolvePermissionModeForHermesMode(HERMES_DEFAULT_MODE_ID)).toBe('normal');
    expect(resolvePermissionModeForHermesMode(HERMES_ACCEPT_EDITS_MODE_ID)).toBe('normal');
    expect(resolvePermissionModeForHermesMode(HERMES_DONT_ASK_MODE_ID)).toBe('yolo');
    expect(resolvePermissionModeForHermesMode('plan')).toBeNull();
  });

  it('recognizes only the ids the ACP server accepts', () => {
    expect(isKnownHermesModeId(HERMES_ACCEPT_EDITS_MODE_ID)).toBe(true);
    expect(isKnownHermesModeId('plan')).toBe(false);
  });
});
