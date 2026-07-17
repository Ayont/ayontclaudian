import type { ProviderId } from './types';

type ProviderConfigMap = Partial<Record<string, Record<string, unknown>>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function getProviderConfig(
  settings: Record<string, unknown>,
  providerId: ProviderId,
): Record<string, unknown> {
  const candidate = settings.providerConfigs;
  if (!isRecord(candidate)) {
    return {};
  }

  const config = candidate[providerId];
  return isRecord(config) ? { ...config } : {};
}

/**
 * Flip the persisted `enabled` flag for a provider without touching any of its
 * other raw config fields. Every provider's `getXProviderSettings` reader
 * normalizes on read, so writing the raw flag here is safe and keeps the
 * central "Providers" section in the General settings tab provider-agnostic.
 */
export function setProviderEnabled(
  settings: Record<string, unknown>,
  providerId: ProviderId,
  enabled: boolean,
): void {
  const config = getProviderConfig(settings, providerId);
  setProviderConfig(settings, providerId, { ...config, enabled });
}

export function setProviderConfig(
  settings: Record<string, unknown>,
  providerId: ProviderId,
  config: Record<string, unknown>,
): void {
  const current = settings.providerConfigs;
  const nextConfigs: ProviderConfigMap = isRecord(current)
    ? { ...(current as ProviderConfigMap) }
    : {};

  nextConfigs[providerId] = { ...config };
  settings.providerConfigs = nextConfigs;
}
