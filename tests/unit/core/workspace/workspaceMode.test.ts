import {
  buildSystemPrompt,
  buildTurnOutputContract,
  computeSystemPromptKey,
} from '@/core/prompt/mainAgent';
import {
  DEFAULT_WORKSPACE_MODE,
  getWorkspaceModeClass,
  getWorkspaceModeInstructions,
  getWorkspaceModeMeta,
  getWorkspaceQuickPrompts,
  normalizeWorkspaceMode,
  WORKSPACE_MODE_CLASSES,
} from '@/core/workspace/workspaceMode';

describe('normalizeWorkspaceMode', () => {
  it('accepts the two valid modes', () => {
    expect(normalizeWorkspaceMode('code')).toBe('code');
    expect(normalizeWorkspaceMode('work')).toBe('work');
  });

  it('falls back to the default for unknown/legacy values', () => {
    expect(normalizeWorkspaceMode(undefined)).toBe(DEFAULT_WORKSPACE_MODE);
    expect(normalizeWorkspaceMode(null)).toBe(DEFAULT_WORKSPACE_MODE);
    expect(normalizeWorkspaceMode('WORK')).toBe(DEFAULT_WORKSPACE_MODE);
    expect(normalizeWorkspaceMode(42)).toBe(DEFAULT_WORKSPACE_MODE);
  });
});

describe('workspace mode metadata', () => {
  it('provides German UI meta for both modes', () => {
    expect(getWorkspaceModeMeta('code').label).toBe('Code');
    expect(getWorkspaceModeMeta('work').label).toBe('Work');
    expect(getWorkspaceModeMeta('code').placeholder).toBe('Was bauen wir?');
    expect(getWorkspaceModeMeta('work').placeholder).toBe('Woran arbeiten wir?');
  });

  it('maps modes onto container classes covered by the removal list', () => {
    expect(getWorkspaceModeClass('code')).toBe('claudian-mode-code');
    expect(getWorkspaceModeClass('work')).toBe('claudian-mode-work');
    expect(WORKSPACE_MODE_CLASSES).toContain(getWorkspaceModeClass('code'));
    expect(WORKSPACE_MODE_CLASSES).toContain(getWorkspaceModeClass('work'));
  });
});

describe('getWorkspaceModeInstructions', () => {
  it('describes the WORK job without dropping capabilities', () => {
    const work = getWorkspaceModeInstructions('work');
    expect(work).toContain('Active Workspace Mode: WORK');
    expect(work).toContain('claudian-document');
    expect(work).toContain('Keep all capabilities');
  });

  it('describes the CODE job without dropping capabilities', () => {
    const code = getWorkspaceModeInstructions('code');
    expect(code).toContain('Active Workspace Mode: CODE');
    expect(code).toContain('Keep all capabilities');
  });
});

describe('turn output contract workspace mode wiring', () => {
  it('defaults to CODE mode', () => {
    const prompt = buildTurnOutputContract({ text: 'Hilf mir.' });
    expect(prompt).toContain('Active Workspace Mode: CODE');
    expect(prompt).not.toContain('Active Workspace Mode: WORK');
  });

  it('switches the section in WORK mode', () => {
    const prompt = buildTurnOutputContract({ text: 'Hilf mir.' }, { workspaceMode: 'work' });
    expect(prompt).toContain('Active Workspace Mode: WORK');
    expect(prompt).not.toContain('Active Workspace Mode: CODE');
  });

  it('keeps custom instructions in the base prompt without duplicating the mode', () => {
    const prompt = buildSystemPrompt({ customPrompt: 'Meine Regeln', workspaceMode: 'work' });
    expect(prompt).toContain('Meine Regeln');
    expect(prompt).not.toContain('Active Workspace Mode:');
  });
});

describe('computeSystemPromptKey workspace mode wiring', () => {
  it('does not restart a persistent runtime when only the turn-scoped mode changes', () => {
    const base = { mediaFolder: 'm', customPrompt: 'c', vaultPath: '/v', userName: 'n' };
    const codeKey = computeSystemPromptKey({ ...base, workspaceMode: 'code' });
    const workKey = computeSystemPromptKey({ ...base, workspaceMode: 'work' });
    expect(codeKey).toBe(workKey);
  });

  it('treats the default and explicit code mode as the same key', () => {
    const base = { mediaFolder: 'm', customPrompt: 'c', vaultPath: '/v', userName: 'n' };
    expect(computeSystemPromptKey(base)).toBe(
      computeSystemPromptKey({ ...base, workspaceMode: 'code' }),
    );
  });
});

describe('getWorkspaceQuickPrompts', () => {
  it('provides distinct, non-empty quick actions per mode', () => {
    const code = getWorkspaceQuickPrompts('code');
    const work = getWorkspaceQuickPrompts('work');
    expect(code.length).toBeGreaterThanOrEqual(3);
    expect(work.length).toBeGreaterThanOrEqual(3);
    for (const quick of [...code, ...work]) {
      expect(quick.label.trim()).not.toBe('');
      expect(quick.prompt.trim()).not.toBe('');
      expect(quick.icon.trim()).not.toBe('');
    }
    const codeLabels = new Set(code.map((quick) => quick.label));
    expect(work.some((quick) => codeLabels.has(quick.label))).toBe(false);
  });
});
