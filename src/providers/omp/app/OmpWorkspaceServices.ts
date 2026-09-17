import type { ProviderCommandCatalog } from '../../../core/providers/commands/ProviderCommandCatalog';
import { ProviderWorkspaceRegistry } from '../../../core/providers/ProviderWorkspaceRegistry';
import type {
  ProviderTabWarmupPolicy,
  ProviderWorkspaceRegistration,
  ProviderWorkspaceServices,
} from '../../../core/providers/types';
import type { VaultFileAdapter } from '../../../core/storage/VaultFileAdapter';
import { OmpAgentMentionProvider } from '../agents/OmpAgentMentionProvider';
import { OmpCommandCatalog } from '../commands/OmpCommandCatalog';
import { OmpCliResolver } from '../runtime/OmpCliResolver';
import { OmpAgentStorage } from '../storage/OmpAgentStorage';
import { ompSettingsTabRenderer } from '../ui/OmpSettingsTab';
import { OmpRuntimeCommandLoader } from './OmpRuntimeCommandLoader';

export interface OmpWorkspaceServices extends ProviderWorkspaceServices {
  agentStorage: OmpAgentStorage;
  agentMentionProvider: OmpAgentMentionProvider;
  commandCatalog: ProviderCommandCatalog;
}

const ompTabWarmupPolicy: ProviderTabWarmupPolicy = {
  resolveMode() {
    return 'commands';
  },
};

export async function createOmpWorkspaceServices(
  vaultAdapter: VaultFileAdapter,
): Promise<OmpWorkspaceServices> {
  const agentStorage = new OmpAgentStorage(vaultAdapter);
  const agentMentionProvider = new OmpAgentMentionProvider(agentStorage);
  await agentMentionProvider.loadAgents();

  return {
    agentStorage,
    agentMentionProvider,
    commandCatalog: new OmpCommandCatalog(),
    cliResolver: new OmpCliResolver(),
    runtimeCommandLoader: new OmpRuntimeCommandLoader(),
    settingsTabRenderer: ompSettingsTabRenderer,
    tabWarmupPolicy: ompTabWarmupPolicy,
    refreshAgentMentions: async () => {
      await agentMentionProvider.loadAgents();
    },
  };
}

export const ompWorkspaceRegistration: ProviderWorkspaceRegistration<OmpWorkspaceServices> = {
  initialize: async ({ vaultAdapter }) => createOmpWorkspaceServices(vaultAdapter),
};

export function maybeGetOmpWorkspaceServices(): OmpWorkspaceServices | null {
  return ProviderWorkspaceRegistry.getServices('omp') as OmpWorkspaceServices | null;
}
