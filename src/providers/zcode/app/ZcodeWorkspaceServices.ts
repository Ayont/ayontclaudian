import { SharedVaultCommandCatalog } from '../../../core/providers/commands/SharedVaultCommandCatalog';
import { ProviderWorkspaceRegistry } from '../../../core/providers/ProviderWorkspaceRegistry';
import type {
  ProviderWorkspaceRegistration,
  ProviderWorkspaceServices,
} from '../../../core/providers/types';
import type { VaultFileAdapter } from '../../../core/storage/VaultFileAdapter';
import { SkillStorage } from '../../claude/storage/SkillStorage';
import { SlashCommandStorage } from '../../claude/storage/SlashCommandStorage';
import { ZcodeCliResolver } from '../runtime/ZcodeCliResolver';
import { zcodeSettingsTabRenderer } from '../ui/ZcodeSettingsTab';

export type ZcodeWorkspaceServices = ProviderWorkspaceServices;

export async function createZcodeWorkspaceServices(
  adapter: VaultFileAdapter,
): Promise<ZcodeWorkspaceServices> {
  return {
    cliResolver: new ZcodeCliResolver(),
    settingsTabRenderer: zcodeSettingsTabRenderer,
    commandCatalog: new SharedVaultCommandCatalog(
      'zcode',
      new SlashCommandStorage(adapter),
      new SkillStorage(adapter),
    ),
  };
}

export const zcodeWorkspaceRegistration: ProviderWorkspaceRegistration<ZcodeWorkspaceServices> = {
  initialize: async ({ vaultAdapter }) => createZcodeWorkspaceServices(vaultAdapter),
};

export function maybeGetZcodeWorkspaceServices(): ZcodeWorkspaceServices | null {
  return ProviderWorkspaceRegistry.getServices('zcode') as ZcodeWorkspaceServices | null;
}
