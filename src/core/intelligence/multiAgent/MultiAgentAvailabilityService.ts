import { ProviderRegistry } from '../../providers/ProviderRegistry';
import type { ProviderId } from '../../types/provider';

/**
 * Decides whether multi-agent missions are available for a given provider.
 *
 * Multi-agent is available when:
 *  - the provider is registered
 *  - its capabilities declare `supportsMultiAgent: true`
 */
export class MultiAgentAvailabilityService {
  isAvailable(providerId: ProviderId): boolean {
    const registration = ProviderRegistry.getProviderRegistrationSafe(providerId);
    if (!registration) {
      return false;
    }
    return registration.capabilities.supportsMultiAgent === true;
  }

  /**
   * Return all registered provider ids that support multi-agent missions,
   * ordered by their `blankTabOrder`.
   */
  getEligibleProviderIds(): ProviderId[] {
    return ProviderRegistry.getRegisteredProviderIds()
      .filter((id) => this.isAvailable(id))
      .sort((a, b) => {
        const regA = ProviderRegistry.getProviderRegistrationSafe(a);
        const regB = ProviderRegistry.getProviderRegistrationSafe(b);
        return (regA?.blankTabOrder ?? 0) - (regB?.blankTabOrder ?? 0);
      });
  }
}

/** Shared singleton for the multi-agent availability service. */
export const multiAgentAvailabilityService = new MultiAgentAvailabilityService();
