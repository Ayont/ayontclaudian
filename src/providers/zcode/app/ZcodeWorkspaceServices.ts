import { SharedVaultCommandCatalog } from '../../../core/providers/commands/SharedVaultCommandCatalog';
import { ProviderWorkspaceRegistry } from '../../../core/providers/ProviderWorkspaceRegistry';
import { createPersistentRuntimeWarmupPolicy } from '../../../core/providers/tabWarmup';
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

/**
 * Brings the runtime up at tab open so the CLI cold start is off the
 * first-response path. See createPersistentRuntimeWarmupPolicy.
 */
export const zcodeTabWarmupPolicy = createPersistentRuntimeWarmupPolicy('zcode');

export async function createZcodeWorkspaceServices(
  adapter: VaultFileAdapter,
): Promise<ZcodeWorkspaceServices> {
  return {
    tabWarmupPolicy: zcodeTabWarmupPolicy,
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
