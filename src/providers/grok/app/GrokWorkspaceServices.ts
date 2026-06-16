import { SharedVaultCommandCatalog } from '../../../core/providers/commands/SharedVaultCommandCatalog';
import { ProviderWorkspaceRegistry } from '../../../core/providers/ProviderWorkspaceRegistry';
import type {
  ProviderWorkspaceRegistration,
  ProviderWorkspaceServices,
} from '../../../core/providers/types';
import type { VaultFileAdapter } from '../../../core/storage/VaultFileAdapter';
import { SkillStorage } from '../../claude/storage/SkillStorage';
import { SlashCommandStorage } from '../../claude/storage/SlashCommandStorage';
import { GrokCliResolver } from '../runtime/GrokCliResolver';
import { grokSettingsTabRenderer } from '../ui/GrokSettingsTab';

export type GrokWorkspaceServices = ProviderWorkspaceServices;

export async function createGrokWorkspaceServices(
  adapter: VaultFileAdapter,
): Promise<GrokWorkspaceServices> {
  return {
    cliResolver: new GrokCliResolver(),
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
  initialize: async ({ vaultAdapter }) => createGrokWorkspaceServices(vaultAdapter),
};

export function maybeGetGrokWorkspaceServices(): GrokWorkspaceServices | null {
  return ProviderWorkspaceRegistry.getServices('grok') as GrokWorkspaceServices | null;
}
