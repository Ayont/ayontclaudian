import { getBuiltInProviderDefaultConfigs } from '../../providers/defaultProviderConfigs';
import { getProviderConfig, setProviderConfig } from './providerConfig';
import { ProviderRegistry } from './ProviderRegistry';
import type { ProviderConfigValidator, ProviderConfigValidatorIssue, ProviderId } from './types';

export interface ProviderConfigIssue extends ProviderConfigValidatorIssue {
  providerId: ProviderId;
}

export interface ProviderConfigValidationResult {
  issues: ProviderConfigIssue[];
  repairable: boolean;
}

export interface ProviderConfigRepairResult {
  repaired: boolean;
  issues: ProviderConfigIssue[];
}

const BUILT_IN_DEFAULTS = getBuiltInProviderDefaultConfigs();

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function getDefaultProviderConfig(providerId: ProviderId): Record<string, unknown> {
  const builtIn = BUILT_IN_DEFAULTS[providerId];
  if (isRecord(builtIn)) {
    return { ...builtIn };
  }
  const registration = ProviderRegistry.getProviderRegistration(providerId);
  if (registration.defaultConfig && isRecord(registration.defaultConfig)) {
    return { ...registration.defaultConfig };
  }
  return {};
}

function getProviderSpecificValidator(providerId: ProviderId): ProviderConfigValidator | null {
  return ProviderRegistry.getProviderRegistration(providerId).configValidator ?? null;
}

function validateStructuralConfig(
  providerId: ProviderId,
  config: Record<string, unknown>,
  defaults: Record<string, unknown>,
): ProviderConfigIssue[] {
  const issues: ProviderConfigIssue[] = [];

  for (const [key, defaultValue] of Object.entries(defaults)) {
    if (!(key in config)) {
      issues.push({
        providerId,
        severity: 'error',
        code: 'missing-field',
        message: `Missing provider config field "${key}"`,
        autoRepairable: true,
        field: key,
      });
      continue;
    }

    const actualValue = config[key];
    if (actualValue === undefined) {
      issues.push({
        providerId,
        severity: 'error',
        code: 'undefined-field',
        message: `Provider config field "${key}" is undefined`,
        autoRepairable: true,
        field: key,
      });
      continue;
    }

    if (typeof actualValue !== typeof defaultValue) {
      issues.push({
        providerId,
        severity: 'error',
        code: 'type-mismatch',
        message: `Provider config field "${key}" has wrong type (expected ${typeof defaultValue})`,
        autoRepairable: true,
        field: key,
      });
    }
  }

  for (const key of Object.keys(config)) {
    if (!(key in defaults)) {
      issues.push({
        providerId,
        severity: 'warning',
        code: 'unknown-field',
        message: `Unknown provider config field "${key}"`,
        autoRepairable: false,
        field: key,
      });
    }
  }

  return issues;
}

/**
 * Validate a single provider's config bag. Cross-cutting structural checks use
 * the built-in defaults; provider-specific validators can add extra rules.
 */
export function validateProviderConfig(
  providerId: ProviderId,
  settings: Record<string, unknown>,
): ProviderConfigValidationResult {
  const issues: ProviderConfigIssue[] = [];
  const defaults = getDefaultProviderConfig(providerId);
  const config = getProviderConfig(settings, providerId);

  if (!isRecord(config)) {
    issues.push({
      providerId,
      severity: 'error',
      code: 'missing-config',
      message: `Provider config for "${providerId}" is missing or not an object`,
      autoRepairable: true,
    });
  } else {
    issues.push(...validateStructuralConfig(providerId, config, defaults));
  }

  const providerValidator = getProviderSpecificValidator(providerId);
  if (providerValidator) {
    const providerIssues = providerValidator.validate(settings);
    for (const issue of providerIssues) {
      issues.push({ ...issue, providerId });
    }
  }

  const repairable = issues.every((issue) => issue.autoRepairable);
  return { issues, repairable };
}

/**
 * Auto-repair a provider config by merging missing fields from defaults and
 * coercing wrong types back to defaults. Unknown fields are left untouched.
 * Returns whether anything changed and the remaining issues.
 */
export function repairProviderConfig(
  providerId: ProviderId,
  settings: Record<string, unknown>,
): ProviderConfigRepairResult {
  const defaults = getDefaultProviderConfig(providerId);
  let config = getProviderConfig(settings, providerId);
  let repaired = false;

  if (!isRecord(config)) {
    config = { ...defaults };
    repaired = true;
  }

  const next: Record<string, unknown> = { ...config };

  for (const [key, defaultValue] of Object.entries(defaults)) {
    if (!(key in next) || next[key] === undefined || typeof next[key] !== typeof defaultValue) {
      next[key] = defaultValue;
      repaired = true;
    }
  }

  if (repaired) {
    setProviderConfig(settings, providerId, next);
  }

  const { issues } = validateProviderConfig(providerId, settings);
  return { repaired, issues };
}

/**
 * Validate all registered providers. Unknown provider ids in `providerConfigs`
 * are ignored by this function (they are surfaced as warnings by
 * `validateProviderConfig` when called explicitly).
 */
export function validateAllProviderConfigs(
  settings: Record<string, unknown>,
): ProviderConfigValidationResult {
  const allIssues: ProviderConfigIssue[] = [];
  let allRepairable = true;

  for (const providerId of ProviderRegistry.getRegisteredProviderIds()) {
    const { issues, repairable } = validateProviderConfig(providerId, settings);
    allIssues.push(...issues);
    if (!repairable) {
      allRepairable = false;
    }
  }

  return { issues: allIssues, repairable: allRepairable };
}

/**
 * Repair all registered providers. Returns true if any provider was modified.
 */
export function repairAllProviderConfigs(
  settings: Record<string, unknown>,
): { repaired: boolean; results: Record<ProviderId, ProviderConfigRepairResult> } {
  let anyRepaired = false;
  const results: Record<ProviderId, ProviderConfigRepairResult> = {};

  for (const providerId of ProviderRegistry.getRegisteredProviderIds()) {
    const result = repairProviderConfig(providerId, settings);
    results[providerId] = result;
    if (result.repaired) {
      anyRepaired = true;
    }
  }

  return { repaired: anyRepaired, results };
}
