import type { ProviderCommandCatalog } from '../../../core/providers/commands/ProviderCommandCatalog';
import { ProviderWorkspaceRegistry } from '../../../core/providers/ProviderWorkspaceRegistry';
import type {
  ProviderTabWarmupPolicy,
  ProviderWorkspaceRegistration,
  ProviderWorkspaceServices,
} from '../../../core/providers/types';
import { HermesCommandCatalog } from '../commands/HermesCommandCatalog';
import { HermesCliResolver } from '../runtime/HermesCliResolver';
import { HERMES_PROVIDER_ID } from '../settings';
import { hermesSettingsTabRenderer } from '../ui/HermesSettingsTab';
import { HermesRuntimeCommandLoader } from './HermesRuntimeCommandLoader';

export interface HermesWorkspaceServices extends ProviderWorkspaceServices {
  commandCatalog: ProviderCommandCatalog;
}

// Commands arrive over ACP, so a blank tab warms command discovery only — a
// full runtime prime would boot Hermes' plugin discovery for nothing.
const hermesTabWarmupPolicy: ProviderTabWarmupPolicy = {
  resolveMode() {
    return 'commands';
  },
};

export function createHermesWorkspaceServices(): HermesWorkspaceServices {
  return {
    cliResolver: new HermesCliResolver(),
    commandCatalog: new HermesCommandCatalog(),
    runtimeCommandLoader: new HermesRuntimeCommandLoader(),
    settingsTabRenderer: hermesSettingsTabRenderer,
    tabWarmupPolicy: hermesTabWarmupPolicy,
  };
}

export const hermesWorkspaceRegistration: ProviderWorkspaceRegistration<HermesWorkspaceServices> = {
  initialize: async () => createHermesWorkspaceServices(),
};

export function maybeGetHermesWorkspaceServices(): HermesWorkspaceServices | null {
  return ProviderWorkspaceRegistry.getServices(HERMES_PROVIDER_ID) as HermesWorkspaceServices | null;
}
