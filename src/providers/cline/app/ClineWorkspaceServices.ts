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
import { ClineCliResolver } from '../runtime/ClineCliResolver';
import { CLINE_PROVIDER_ID } from '../settings';
import { clineSettingsTabRenderer } from '../ui/ClineSettingsTab';

export type ClineWorkspaceServices = ProviderWorkspaceServices;

/**
 * Brings the runtime up at tab open so the CLI cold start is off the
 * first-response path. See createPersistentRuntimeWarmupPolicy.
 */
export const clineTabWarmupPolicy = createPersistentRuntimeWarmupPolicy('cline');

export async function createClineWorkspaceServices(
  adapter: VaultFileAdapter,
): Promise<ClineWorkspaceServices> {
  return {
    tabWarmupPolicy: clineTabWarmupPolicy,
    cliResolver: new ClineCliResolver(),
    settingsTabRenderer: clineSettingsTabRenderer,
    commandCatalog: new SharedVaultCommandCatalog(
      CLINE_PROVIDER_ID,
      new SlashCommandStorage(adapter),
      new SkillStorage(adapter),
    ),
  };
}

export const clineWorkspaceRegistration: ProviderWorkspaceRegistration<ClineWorkspaceServices> = {
  initialize: async ({ vaultAdapter }) => createClineWorkspaceServices(vaultAdapter),
};

export function maybeGetClineWorkspaceServices(): ClineWorkspaceServices | null {
  return ProviderWorkspaceRegistry.getServices(CLINE_PROVIDER_ID) as ClineWorkspaceServices | null;
}
