import { SharedVaultCommandCatalog } from '../../../core/providers/commands/SharedVaultCommandCatalog';
import { ProviderWorkspaceRegistry } from '../../../core/providers/ProviderWorkspaceRegistry';
import type {
  ProviderWorkspaceRegistration,
  ProviderWorkspaceServices,
} from '../../../core/providers/types';
import type { VaultFileAdapter } from '../../../core/storage/VaultFileAdapter';
import { SkillStorage } from '../../claude/storage/SkillStorage';
import { SlashCommandStorage } from '../../claude/storage/SlashCommandStorage';
import { VibeCliResolver } from '../runtime/VibeCliResolver';
import { vibeSettingsTabRenderer } from '../ui/VibeSettingsTab';

export type VibeWorkspaceServices = ProviderWorkspaceServices;

export async function createVibeWorkspaceServices(
  adapter: VaultFileAdapter,
): Promise<VibeWorkspaceServices> {
  return {
    cliResolver: new VibeCliResolver(),
    settingsTabRenderer: vibeSettingsTabRenderer,
    // Surfaces the shared vault commands/skills (.claude/commands, .claude/skills)
    // in the dropdown; VibeChatRuntime expands a chosen entry client-side.
    commandCatalog: new SharedVaultCommandCatalog(
      'vibe',
      new SlashCommandStorage(adapter),
      new SkillStorage(adapter),
    ),
  };
}

export const vibeWorkspaceRegistration: ProviderWorkspaceRegistration<VibeWorkspaceServices> = {
  initialize: async ({ vaultAdapter }) => createVibeWorkspaceServices(vaultAdapter),
};

export function maybeGetVibeWorkspaceServices(): VibeWorkspaceServices | null {
  return ProviderWorkspaceRegistry.getServices('vibe') as VibeWorkspaceServices | null;
}
