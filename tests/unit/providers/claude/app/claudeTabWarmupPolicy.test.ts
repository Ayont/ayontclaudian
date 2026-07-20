import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import type { ProviderTabWarmupContext } from '@/core/providers/types';
import { AUTO_MODEL_VALUE } from '@/core/routing/modelRouterRules';
import { claudeTabWarmupPolicy } from '@/providers/claude/app/ClaudeWorkspaceServices';

jest.mock('@/providers/claude/storage/StorageService', () => ({ StorageService: jest.fn() }));
jest.mock('@/providers/claude/agents/AgentManager', () => ({ AgentManager: jest.fn() }));
jest.mock('@/providers/claude/plugins/PluginManager', () => ({ PluginManager: jest.fn() }));
jest.mock('@/providers/claude/commands/ClaudeCommandCatalog', () => ({ ClaudeCommandCatalog: jest.fn() }));
jest.mock('@/providers/claude/commands/probeRuntimeCommands', () => ({ probeRuntimeCommands: jest.fn() }));
jest.mock('@/providers/claude/ui/ClaudeSettingsTab', () => ({ claudeSettingsTabRenderer: {} }));
jest.mock('@/providers/claude/runtime/ClaudeCliResolver', () => ({ ClaudeCliResolver: jest.fn() }));
jest.mock('@/core/mcp/McpServerManager', () => ({ McpServerManager: jest.fn() }));

function makeContext(tab: Partial<ProviderTabWarmupContext['tab']>): ProviderTabWarmupContext {
  return {
    conversation: null,
    externalContextPaths: [],
    plugin: { settings: {} } as unknown as ProviderTabWarmupContext['plugin'],
    runtime: null,
    tab: {
      conversationId: null,
      draftModel: null,
      lifecycleState: 'bound_cold',
      providerId: 'claude',
      ...tab,
    },
  };
}

describe('claudeTabWarmupPolicy', () => {
  const resolveSpy = jest.spyOn(ProviderRegistry, 'resolveProviderForModel');

  afterEach(() => {
    resolveSpy.mockReset();
  });

  it('warms the runtime for bound tabs (spawn moves off the first send)', () => {
    expect(claudeTabWarmupPolicy.resolveMode(makeContext({}))).toBe('runtime');
    expect(resolveSpy).not.toHaveBeenCalled();
  });

  it('warms blank tabs without a draft model and with the Auto sentinel', () => {
    expect(
      claudeTabWarmupPolicy.resolveMode(makeContext({ lifecycleState: 'blank' })),
    ).toBe('runtime');
    expect(
      claudeTabWarmupPolicy.resolveMode(
        makeContext({ lifecycleState: 'blank', draftModel: AUTO_MODEL_VALUE }),
      ),
    ).toBe('runtime');
  });

  it('warms blank tabs whose draft model belongs to Claude', () => {
    resolveSpy.mockReturnValue('claude');
    expect(
      claudeTabWarmupPolicy.resolveMode(
        makeContext({ lifecycleState: 'blank', draftModel: 'sonnet' }),
      ),
    ).toBe('runtime');
  });

  it('skips blank tabs drafting another provider (no wasted spawn)', () => {
    resolveSpy.mockReturnValue('kimi');
    expect(
      claudeTabWarmupPolicy.resolveMode(
        makeContext({ lifecycleState: 'blank', draftModel: 'kimi-k3' }),
      ),
    ).toBe('none');
  });
});
