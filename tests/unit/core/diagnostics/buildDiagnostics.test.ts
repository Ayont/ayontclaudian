import { buildDiagnosticsMarkdown } from '@/core/diagnostics/buildDiagnostics';

const baseInput = {
  pluginVersion: '2.5.0',
  generatedAt: '2026-06-18T10:00:00.000Z',
  permissionMode: 'yolo',
  autoMode: true,
  providers: [
    { id: 'claude', name: 'Claude', enabled: true, cliResolved: true },
    { id: 'vibe', name: 'Vibe', enabled: false, cliResolved: false },
  ],
};

describe('buildDiagnosticsMarkdown', () => {
  it('renders version, settings and a provider table', () => {
    const md = buildDiagnosticsMarkdown({ ...baseInput, activeConversation: null });
    expect(md).toContain('### Claudian diagnostics');
    expect(md).toContain('**Version:** 2.5.0');
    expect(md).toContain('**Auto mode:** ✅');
    expect(md).toContain('| Claude | ✅ | ✅ |');
    expect(md).toContain('| Vibe | ❌ | ❌ |');
    expect(md).toContain('_No active conversation._');
  });

  it('renders the active conversation with a per-provider session map', () => {
    const md = buildDiagnosticsMarkdown({
      ...baseInput,
      activeConversation: {
        id: 'conv-1',
        providerId: 'claude',
        sessionId: 'claude-sess-1',
        goal: 'ship 2.5.0',
        providerSessionIds: { claude: 'claude-sess-1', vibe: null },
      },
    });
    expect(md).toContain('**Active provider:** claude');
    expect(md).toContain('`claude-sess-1`');
    expect(md).toContain('**Goal:** ship 2.5.0');
    expect(md).toContain('claude: `claude-sess-1`');
    expect(md).toContain('vibe: —');
  });

  it('shows dashes when session and goal are absent', () => {
    const md = buildDiagnosticsMarkdown({
      ...baseInput,
      activeConversation: { providerId: 'kimi', sessionId: null, goal: null },
    });
    expect(md).toContain('**Session id:** —');
    expect(md).toContain('**Goal:** —');
  });
});
