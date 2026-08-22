import { SharedVaultCommandCatalog } from '../../../core/providers/commands/SharedVaultCommandCatalog';
import { ProviderWorkspaceRegistry } from '../../../core/providers/ProviderWorkspaceRegistry';
import type {
  ProviderWorkspaceRegistration,
  ProviderWorkspaceServices,
} from '../../../core/providers/types';
import type { VaultFileAdapter } from '../../../core/storage/VaultFileAdapter';
import { SkillStorage } from '../../claude/storage/SkillStorage';
import { SlashCommandStorage } from '../../claude/storage/SlashCommandStorage';
import { DshCliResolver } from '../runtime/DshCliResolver';
import { dshSettingsTabRenderer } from '../ui/DshSettingsTab';

export type DshWorkspaceServices = ProviderWorkspaceServices;

export async function createDshWorkspaceServices(
  adapter: VaultFileAdapter,
): Promise<DshWorkspaceServices> {
  return {
    cliResolver: new DshCliResolver(),
    settingsTabRenderer: dshSettingsTabRenderer,
    // Surfaces the shared vault commands/skills (.claude/commands, .claude/skills)
    // in the dropdown; DshChatRuntime expands a chosen entry client-side.
    commandCatalog: new SharedVaultCommandCatalog(
      'dsh',
      new SlashCommandStorage(adapter),
      new SkillStorage(adapter),
    ),
  };
}

export const dshWorkspaceRegistration: ProviderWorkspaceRegistration<DshWorkspaceServices> = {
  initialize: async ({ vaultAdapter }) => createDshWorkspaceServices(vaultAdapter),
};

export function maybeGetDshWorkspaceServices(): DshWorkspaceServices | null {
  return ProviderWorkspaceRegistry.getServices('dsh') as DshWorkspaceServices | null;
}
