import { ProviderWorkspaceRegistry } from '../../../core/providers/ProviderWorkspaceRegistry';
import type {
  ProviderWorkspaceRegistration,
  ProviderWorkspaceServices,
} from '../../../core/providers/types';
import { freebuffSettingsTabRenderer } from '../ui/FreebuffSettingsTab';

export type FreebuffWorkspaceServices = ProviderWorkspaceServices;

/**
 * Workspace services for the HTTP-only Freebuff provider: no CLI resolver and
 * no command catalog — there is no local binary whose PATH matters, and the
 * desktop app expands its own skills.
 */
export async function createFreebuffWorkspaceServices(): Promise<FreebuffWorkspaceServices> {
  return {
    settingsTabRenderer: freebuffSettingsTabRenderer,
  };
}

export const freebuffWorkspaceRegistration: ProviderWorkspaceRegistration<FreebuffWorkspaceServices> = {
  initialize: async () => createFreebuffWorkspaceServices(),
};

export function maybeGetFreebuffWorkspaceServices(): FreebuffWorkspaceServices | null {
  return ProviderWorkspaceRegistry.getServices('freebuff') as FreebuffWorkspaceServices | null;
}