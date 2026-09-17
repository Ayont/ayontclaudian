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
import { KIMI_STATIC_COMMANDS } from '../commands/kimiStaticCommands';
import { KimiCliResolver } from '../runtime/KimiCliResolver';
import { kimiSettingsTabRenderer } from '../ui/KimiSettingsTab';

export type KimiWorkspaceServices = ProviderWorkspaceServices;

/**
 * Brings the runtime up at tab open so the CLI cold start is off the
 * first-response path. See createPersistentRuntimeWarmupPolicy.
 */
export const kimiTabWarmupPolicy = createPersistentRuntimeWarmupPolicy('kimi');

export async function createKimiWorkspaceServices(
  adapter: VaultFileAdapter,
): Promise<KimiWorkspaceServices> {
  return {
    tabWarmupPolicy: kimiTabWarmupPolicy,
    cliResolver: new KimiCliResolver(),
    settingsTabRenderer: kimiSettingsTabRenderer,
    // Surfaces the shared vault commands/skills (.claude/commands, .claude/skills)
    // in the dropdown. Kimi users expect to trigger skills with "/" (matching
    // Kimi CLI's "/skill:<name>" convention), so skills use "/" here; the runtime
    // still expands a chosen entry client-side.
    commandCatalog: new SharedVaultCommandCatalog(
      'kimi',
      new SlashCommandStorage(adapter),
      new SkillStorage(adapter),
      { skillInsertPrefix: '/', staticEntries: KIMI_STATIC_COMMANDS },
    ),
  };
}

export const kimiWorkspaceRegistration: ProviderWorkspaceRegistration<KimiWorkspaceServices> = {
  initialize: async ({ vaultAdapter }) => createKimiWorkspaceServices(vaultAdapter),
};

export function maybeGetKimiWorkspaceServices(): KimiWorkspaceServices | null {
  return ProviderWorkspaceRegistry.getServices('kimi') as KimiWorkspaceServices | null;
}
