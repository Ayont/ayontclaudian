import { McpServerManager } from '../../../core/mcp/McpServerManager';
import type { ProviderCommandCatalog } from '../../../core/providers/commands/ProviderCommandCatalog';
import { ProviderRegistry } from '../../../core/providers/ProviderRegistry';
import { ProviderWorkspaceRegistry } from '../../../core/providers/ProviderWorkspaceRegistry';
import type {
  AppAgentManager,
  AppAgentStorage,
  AppMcpStorage,
  AppPluginManager,
  ProviderCliResolver,
  ProviderTabWarmupPolicy,
  ProviderWorkspaceRegistration,
  ProviderWorkspaceServices,
} from '../../../core/providers/types';
import { AUTO_MODEL_VALUE } from '../../../core/routing/modelRouterRules';
import type { VaultFileAdapter } from '../../../core/storage/VaultFileAdapter';
import type ClaudianPlugin from '../../../main';
import { getVaultPath } from '../../../utils/path';
import { AgentManager } from '../agents/AgentManager';
import { ClaudeCommandCatalog } from '../commands/ClaudeCommandCatalog';
import { probeRuntimeCommands } from '../commands/probeRuntimeCommands';
import { PluginManager } from '../plugins/PluginManager';
import { ClaudeCliResolver } from '../runtime/ClaudeCliResolver';
import { StorageService } from '../storage/StorageService';
import { claudeSettingsTabRenderer } from '../ui/ClaudeSettingsTab';

/**
 * Warm the Claude runtime as soon as a tab becomes active — spawning the
 * persistent CLI query at tab open/switch instead of on the first send moves
 * the multi-second cold start OFF the first-response path (the long-standing
 * "spawn at warmup" speed lever). `ensureReady()` is idempotent, so repeat
 * warmups are no-ops.
 *
 * Guard: a BLANK tab whose draft model belongs to another provider skips the
 * warmup — spawning Claude for a Kimi/Codex draft would be wasted work.
 */
export const claudeTabWarmupPolicy: ProviderTabWarmupPolicy = {
  resolveMode(context) {
    const { draftModel, lifecycleState } = context.tab;
    if (lifecycleState === 'blank' && draftModel && draftModel !== AUTO_MODEL_VALUE) {
      const draftProvider = ProviderRegistry.resolveProviderForModel(
        draftModel,
        context.plugin.settings as unknown as Record<string, unknown>,
      );
      if (draftProvider !== 'claude') {
        return 'none';
      }
    }
    return 'runtime';
  },
};

export interface ClaudeWorkspaceServices extends ProviderWorkspaceServices {
  claudeStorage: StorageService;
  cliResolver: ProviderCliResolver;
  mcpStorage: AppMcpStorage;
  mcpManager: McpServerManager;
  pluginManager: AppPluginManager;
  agentStorage: AppAgentStorage;
  agentManager: AppAgentManager;
  commandCatalog: ProviderCommandCatalog;
  agentMentionProvider: AppAgentManager;
}

export async function createClaudeWorkspaceServices(
  plugin: ClaudianPlugin,
  adapter: VaultFileAdapter,
): Promise<ClaudeWorkspaceServices> {
  const claudeStorage = new StorageService(plugin, adapter);
  await claudeStorage.ensureDirectories();

  const cliResolver = new ClaudeCliResolver();
  const mcpStorage = claudeStorage.mcp;
  const mcpManager = new McpServerManager(mcpStorage);
  await mcpManager.loadServers();

  const vaultPath = getVaultPath(plugin.app) ?? '';
  const pluginManager = new PluginManager(vaultPath, claudeStorage.ccSettings);
  await pluginManager.loadPlugins();

  const agentStorage = claudeStorage.agents;
  const agentManager = new AgentManager(vaultPath, pluginManager);
  await agentManager.loadAgents();

  const commandCatalog = new ClaudeCommandCatalog(
    claudeStorage.commands,
    claudeStorage.skills,
    () => probeRuntimeCommands(plugin),
  );

  return {
    tabWarmupPolicy: claudeTabWarmupPolicy,
    claudeStorage,
    cliResolver,
    mcpStorage,
    mcpServerManager: mcpManager,
    mcpManager,
    pluginManager,
    agentStorage,
    agentManager,
    commandCatalog,
    agentMentionProvider: agentManager,
    settingsTabRenderer: claudeSettingsTabRenderer,
    refreshAgentMentions: async () => {
      await agentManager.loadAgents();
    },
  };
}

export const claudeWorkspaceRegistration: ProviderWorkspaceRegistration<ClaudeWorkspaceServices> = {
  initialize: async ({ plugin, vaultAdapter }) => createClaudeWorkspaceServices(plugin, vaultAdapter),
};

export function maybeGetClaudeWorkspaceServices(): ClaudeWorkspaceServices | null {
  return ProviderWorkspaceRegistry.getServices('claude') as ClaudeWorkspaceServices | null;
}

export function getClaudeWorkspaceServices(): ClaudeWorkspaceServices {
  return ProviderWorkspaceRegistry.requireServices('claude') as ClaudeWorkspaceServices;
}
