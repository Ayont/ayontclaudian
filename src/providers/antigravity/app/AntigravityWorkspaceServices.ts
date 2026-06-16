import { SharedVaultCommandCatalog } from '../../../core/providers/commands/SharedVaultCommandCatalog';
import { ProviderWorkspaceRegistry } from '../../../core/providers/ProviderWorkspaceRegistry';
import type {
  ProviderWorkspaceRegistration,
  ProviderWorkspaceServices,
} from '../../../core/providers/types';
import type { VaultFileAdapter } from '../../../core/storage/VaultFileAdapter';
import { SkillStorage } from '../../claude/storage/SkillStorage';
import { SlashCommandStorage } from '../../claude/storage/SlashCommandStorage';
import { AntigravityCliResolver } from '../runtime/AntigravityCliResolver';
import { antigravitySettingsTabRenderer } from '../ui/AntigravitySettingsTab';

export type AntigravityWorkspaceServices = ProviderWorkspaceServices;

export async function createAntigravityWorkspaceServices(
  adapter: VaultFileAdapter,
): Promise<AntigravityWorkspaceServices> {
  return {
    cliResolver: new AntigravityCliResolver(),
    settingsTabRenderer: antigravitySettingsTabRenderer,
    // Surfaces the shared vault commands/skills (.claude/commands, .claude/skills)
    // in the dropdown; AntigravityChatRuntime expands a chosen entry client-side.
    commandCatalog: new SharedVaultCommandCatalog(
      'antigravity',
      new SlashCommandStorage(adapter),
      new SkillStorage(adapter),
    ),
  };
}

export const antigravityWorkspaceRegistration: ProviderWorkspaceRegistration<AntigravityWorkspaceServices> = {
  initialize: async ({ vaultAdapter }) => createAntigravityWorkspaceServices(vaultAdapter),
};

export function maybeGetAntigravityWorkspaceServices(): AntigravityWorkspaceServices | null {
  return ProviderWorkspaceRegistry.getServices('antigravity') as AntigravityWorkspaceServices | null;
}
