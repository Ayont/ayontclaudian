import { SharedVaultCommandCatalog } from '../../../core/providers/commands/SharedVaultCommandCatalog';
import { ProviderWorkspaceRegistry } from '../../../core/providers/ProviderWorkspaceRegistry';
import { createPersistentRuntimeWarmupPolicy } from '../../../core/providers/tabWarmup';
import type {
  ProviderWorkspaceRegistration,
  ProviderWorkspaceServices,
} from '../../../core/providers/types';
import type { VaultFileAdapter } from '../../../core/storage/VaultFileAdapter';
import type ClaudianPlugin from '../../../main';
import { getVaultPath } from '../../../utils/path';
import { SkillStorage } from '../../claude/storage/SkillStorage';
import { SlashCommandStorage } from '../../claude/storage/SlashCommandStorage';
import { GrokAgentCatalog } from '../agents/GrokAgentCatalog';
import { createGrokInspectRunner } from '../agents/grokInspectRunner';
import { GrokCliResolver } from '../runtime/GrokCliResolver';
import { buildGrokRuntimeEnv } from '../runtime/GrokRuntimeEnvironment';
import { grokSettingsTabRenderer } from '../ui/GrokSettingsTab';

export interface GrokWorkspaceServices extends ProviderWorkspaceServices {
  /** Grok bots discovered for this vault, plus the connection report. */
  agentCatalog: GrokAgentCatalog;
}

/**
 * Brings the runtime up at tab open so the CLI cold start is off the
 * first-response path. See createPersistentRuntimeWarmupPolicy.
 */
export const grokTabWarmupPolicy = createPersistentRuntimeWarmupPolicy('grok');

export async function createGrokWorkspaceServices(
  plugin: ClaudianPlugin,
  adapter: VaultFileAdapter,
): Promise<GrokWorkspaceServices> {
  const cliResolver = new GrokCliResolver();
  const settings = () => plugin.settings as unknown as Record<string, unknown>;

  const agentCatalog = new GrokAgentCatalog({
    runInspect: createGrokInspectRunner({
      resolveCommand: () => cliResolver.resolveFromSettings(settings()),
      // Grok reports per working directory, and the vault IS the working
      // directory — inspecting anywhere else would list the wrong bots.
      resolveCwd: () => getVaultPath(plugin.app) ?? '',
      resolveEnv: (command) => buildGrokRuntimeEnv(settings(), command),
    }),
  });

  // Discovery must not delay onload: a cold inspect takes ~2 s, and the
  // catalog is only needed once a Grok tab is actually used.
  void agentCatalog.refresh();

  return {
    tabWarmupPolicy: grokTabWarmupPolicy,
    agentCatalog,
    agentMentionProvider: agentCatalog,
    refreshAgentMentions: () => agentCatalog.refresh(),
    cliResolver,
    settingsTabRenderer: grokSettingsTabRenderer,
    // Surfaces the shared vault commands/skills (.claude/commands, .claude/skills)
    // in the dropdown; GrokChatRuntime expands a chosen entry client-side.
    commandCatalog: new SharedVaultCommandCatalog(
      'grok',
      new SlashCommandStorage(adapter),
      new SkillStorage(adapter),
    ),
  };
}

export const grokWorkspaceRegistration: ProviderWorkspaceRegistration<GrokWorkspaceServices> = {
  initialize: async ({ plugin, vaultAdapter }) => createGrokWorkspaceServices(plugin, vaultAdapter),
};

export function maybeGetGrokWorkspaceServices(): GrokWorkspaceServices | null {
  return ProviderWorkspaceRegistry.getServices('grok') as GrokWorkspaceServices | null;
}
