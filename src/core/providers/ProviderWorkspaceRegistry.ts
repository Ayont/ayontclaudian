import type ClaudianPlugin from '../../main';
import { HomeFileAdapter } from '../storage/HomeFileAdapter';
import type { ProviderCommandCatalog } from './commands/ProviderCommandCatalog';
import { ProviderRegistry } from './ProviderRegistry';
import type {
  AgentMentionProvider,
  ProviderCliResolver,
  ProviderId,
  ProviderRuntimeCommandLoader,
  ProviderSettingsTabRenderer,
  ProviderTabWarmupPolicy,
  ProviderWorkspaceRegistration,
  ProviderWorkspaceServices,
} from './types';

/**
 * Registry for provider-owned workspace/bootstrap services.
 *
 * Unlike `ProviderRegistry`, this boundary owns app-level provider services such
 * as command catalogs, mention providers, MCP/plugin/agent managers, and
 * provider-specific storage adaptors.
 */
export class ProviderWorkspaceRegistry {
  private static registrations: Partial<Record<ProviderId, ProviderWorkspaceRegistration>> = {};
  private static services: Partial<Record<ProviderId, ProviderWorkspaceServices>> = {};

  static register(
    providerId: ProviderId,
    registration: ProviderWorkspaceRegistration,
  ): void {
    this.registrations[providerId] = registration;
  }

  private static getWorkspaceRegistration(providerId: ProviderId): ProviderWorkspaceRegistration {
    const registration = this.registrations[providerId];
    if (!registration) {
      throw new Error(`Provider workspace "${providerId}" is not registered.`);
    }
    return registration;
  }

  /** Resolves once the background half of {@link initializeAll} has settled. */
  private static backgroundInit: Promise<void> = Promise.resolve();

  /**
   * Brings up provider workspace services.
   *
   * This is awaited inside `onload()`, so its duration is added directly to
   * Obsidian's startup. Two rules follow from that:
   *
   * - **Only enabled providers are awaited.** A provider the user switched off
   *   still gets its services (the settings tab needs them to switch it back
   *   on), but it finishes in the background instead of holding up the window.
   *   With 14 providers and most of them off by default, that is most of the
   *   work.
   * - **Failures are isolated.** A single rejection used to propagate out of
   *   `onload()`, which meant no `registerView`, no ribbon icon and no commands
   *   — the plugin looked completely dead because one provider's vault scan
   *   threw. Each initializer now fails on its own.
   */
  static async initializeAll(plugin: ClaudianPlugin): Promise<void> {
    const providerIds = Object.keys(this.registrations);
    const storage = plugin.storage;
    const vaultAdapter = storage.getAdapter();
    const homeAdapter = new HomeFileAdapter();
    const settings = plugin.settings as unknown as Record<string, unknown>;

    const initialize = async (providerId: ProviderId): Promise<void> => {
      try {
        this.services[providerId] = await this.getWorkspaceRegistration(providerId).initialize({
          plugin,
          storage,
          vaultAdapter,
          homeAdapter,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[Claudian] provider workspace "${providerId}" failed to initialize:`, message);
      }
    };

    const isEnabled = (providerId: ProviderId): boolean => {
      try {
        return ProviderRegistry.isEnabled(providerId, settings);
      } catch {
        // An unregistered or half-configured provider is treated as enabled so
        // it is never silently skipped.
        return true;
      }
    };

    const enabled = providerIds.filter(isEnabled);
    const deferred = providerIds.filter((providerId) => !enabled.includes(providerId));

    this.backgroundInit = Promise.all(deferred.map(initialize)).then(() => undefined);
    await Promise.all(enabled.map(initialize));
  }

  /**
   * Awaits the deferred initializers too. Call this before anything that needs
   * services for a provider the user has not enabled (the settings hub).
   */
  static async whenFullyInitialized(): Promise<void> {
    await this.backgroundInit;
  }

  static setServices(
    providerId: ProviderId,
    services: ProviderWorkspaceServices | undefined,
  ): void {
    if (services) {
      this.services[providerId] = services;
    } else {
      delete this.services[providerId];
    }
  }

  static clear(): void {
    this.services = {};
  }

  static getServices(
    providerId: ProviderId,
  ): ProviderWorkspaceServices | null {
    return this.services[providerId] ?? null;
  }

  static requireServices(
    providerId: ProviderId,
  ): ProviderWorkspaceServices {
    const services = this.getServices(providerId);
    if (!services) {
      throw new Error(`Provider workspace "${providerId}" is not initialized.`);
    }
    return services;
  }

  static getCommandCatalog(providerId: ProviderId): ProviderCommandCatalog | null {
    return this.getServices(providerId)?.commandCatalog ?? null;
  }

  static getAgentMentionProvider(providerId: ProviderId): AgentMentionProvider | null {
    return this.getServices(providerId)?.agentMentionProvider ?? null;
  }

  static async refreshAgentMentions(providerId: ProviderId): Promise<void> {
    await this.getServices(providerId)?.refreshAgentMentions?.();
  }

  static getCliResolver(providerId: ProviderId): ProviderCliResolver | null {
    return this.getServices(providerId)?.cliResolver ?? null;
  }

  static getRuntimeCommandLoader(providerId: ProviderId): ProviderRuntimeCommandLoader | null {
    return this.getServices(providerId)?.runtimeCommandLoader ?? null;
  }

  static getTabWarmupPolicy(providerId: ProviderId): ProviderTabWarmupPolicy | null {
    return this.getServices(providerId)?.tabWarmupPolicy ?? null;
  }

  static getMcpServerManager(providerId: ProviderId) {
    return this.getServices(providerId)?.mcpServerManager ?? null;
  }

  static getSettingsTabRenderer(providerId: ProviderId): ProviderSettingsTabRenderer | null {
    return this.getServices(providerId)?.settingsTabRenderer ?? null;
  }
}
