import { ProviderRegistry } from './ProviderRegistry';
import type { ProviderId, ProviderModelConfigSync } from './types';

/**
 * Registry for provider-specific model-config synchronization.
 *
 * Providers like Kimi require custom model ids to be declared in a local config
 * file before the CLI will accept them. This registry lets each provider expose
 * a sync routine without the core knowing provider-specific details.
 */
export class ModelConfigSyncRegistry {
  private static syncers: Partial<Record<ProviderId, ProviderModelConfigSync>> = {};

  static register(providerId: ProviderId, syncer: ProviderModelConfigSync): void {
    this.syncers[providerId] = syncer;
  }

  static getSyncer(providerId: ProviderId): ProviderModelConfigSync | null {
    return this.syncers[providerId] ?? null;
  }

  static clear(): void {
    this.syncers = {};
  }
}

/**
 * Synchronize the model config for a provider. Returns true if the provider
 * handled the model, false if no syncer is registered.
 */
export function syncProviderModelConfig(
  providerId: ProviderId,
  model: string,
  settings: Record<string, unknown>,
): boolean {
  const syncer = ModelConfigSyncRegistry.getSyncer(providerId);
  if (!syncer) {
    return false;
  }
  return syncer.syncModelConfig(model, settings);
}

/**
 * Convenience helper that resolves the provider for a model and syncs its config.
 * Returns true only when a syncer actually made changes.
 */
export function syncModelConfigForModel(
  model: string,
  settings: Record<string, unknown>,
): boolean {
  const providerId = ProviderRegistry.resolveProviderForModel(model, settings, {
    fallbackProviderId: undefined,
  });
  if (!providerId) {
    return false;
  }
  return syncProviderModelConfig(providerId, model, settings);
}
