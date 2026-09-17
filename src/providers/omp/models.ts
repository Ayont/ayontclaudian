export interface OmpDiscoveredModel {
  description?: string;
  label: string;
  rawId: string;
}

export interface OmpModelVariant {
  description?: string;
  label: string;
  value: string;
}

export type OmpThinkingOptionsByModel = Record<string, OmpModelVariant[]>;

export interface OmpBaseModel {
  description?: string;
  label: string;
  rawId: string;
  variants: OmpModelVariant[];
}

export interface OmpDiscoveredModelGroup {
  models: OmpDiscoveredModel[];
  providerKey: string;
  providerLabel: string;
}

export const OMP_SYNTHETIC_MODEL_ID = 'omp';
export const OMP_DEFAULT_THINKING_LEVEL = 'default';

const OMP_MODEL_PREFIX = 'omp:';
const OMP_VARIANT_ASCENDING_ORDER = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'max',
  'xhigh',
] as const;
const OMP_VARIANT_ASCENDING_RANK = new Map<string, number>(
  OMP_VARIANT_ASCENDING_ORDER.map((value, index) => [value, index] as const),
);

export function isOmpModelSelectionId(model: string): boolean {
  return model === OMP_SYNTHETIC_MODEL_ID || model.startsWith(OMP_MODEL_PREFIX);
}

export function encodeOmpModelId(rawModelId: string): string {
  const normalized = rawModelId.trim();
  return normalized ? `${OMP_MODEL_PREFIX}${normalized}` : OMP_SYNTHETIC_MODEL_ID;
}

export function decodeOmpModelId(model: string): string | null {
  if (!model.startsWith(OMP_MODEL_PREFIX)) {
    return null;
  }

  const rawModelId = model.slice(OMP_MODEL_PREFIX.length).trim();
  return rawModelId || null;
}

export function normalizeOmpDiscoveredModels(value: unknown): OmpDiscoveredModel[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized: OmpDiscoveredModel[] = [];
  const seen = new Set<string>();
  for (const entry of value as unknown[]) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      continue;
    }
    const record = entry as Record<string, unknown>;

    const rawId = typeof record.rawId === 'string' ? record.rawId.trim() : '';
    const label = typeof record.label === 'string' ? record.label.trim() : rawId;
    const description = typeof record.description === 'string'
      ? record.description.trim()
      : '';

    if (!rawId || seen.has(rawId)) {
      continue;
    }

    seen.add(rawId);
    normalized.push({
      ...(description ? { description } : {}),
      label: label || rawId,
      rawId,
    });
  }

  return normalized;
}

export function normalizeOmpModelVariants(value: unknown): OmpModelVariant[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const variants: OmpModelVariant[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      continue;
    }

    const record = entry as Record<string, unknown>;
    const rawValue = typeof record.value === 'string' ? record.value.trim() : '';
    if (!rawValue) {
      continue;
    }

    let rawLabel = '';
    if (typeof record.label === 'string') {
      rawLabel = record.label.trim();
    } else if (typeof record.name === 'string') {
      rawLabel = record.name.trim();
    }
    const description = typeof record.description === 'string'
      ? record.description.trim()
      : '';

    variants.push({
      ...(description ? { description } : {}),
      label: rawLabel || formatOmpThinkingLevelLabel(rawValue),
      value: rawValue,
    });
  }

  return dedupeOmpVariants(variants);
}

export function normalizeOmpThinkingOptionsByModel(
  value: unknown,
  discoveredModels: OmpDiscoveredModel[] = [],
): OmpThinkingOptionsByModel {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const normalized: OmpThinkingOptionsByModel = {};
  for (const [rawId, variants] of Object.entries(value as Record<string, unknown>)) {
    const normalizedRawId = resolveOmpBaseModelRawId(rawId.trim(), discoveredModels);
    const normalizedVariants = normalizeOmpModelVariants(variants);
    if (!normalizedRawId || normalizedVariants.length === 0) {
      continue;
    }

    normalized[normalizedRawId] = normalizedVariants;
  }

  return normalized;
}

export function resolveOmpBaseModelRawId(
  rawId: string,
  discoveredModels: OmpDiscoveredModel[] | Set<string>,
): string {
  const normalizedRawId = rawId.trim();
  if (!normalizedRawId) {
    return '';
  }

  const discoveredRawIds = discoveredModels instanceof Set
    ? discoveredModels
    : new Set(discoveredModels.map((model) => model.rawId));
  const slashIndex = normalizedRawId.lastIndexOf('/');
  if (slashIndex <= 0) {
    return normalizedRawId;
  }

  const candidate = normalizedRawId.slice(0, slashIndex);
  if (discoveredRawIds.has(candidate)) {
    return candidate;
  }

  const variant = normalizedRawId.slice(slashIndex + 1).trim().toLowerCase();
  return OMP_VARIANT_ASCENDING_RANK.has(variant)
    ? candidate
    : normalizedRawId;
}

export function extractOmpModelVariantValue(
  rawId: string,
  discoveredModels: OmpDiscoveredModel[] | Set<string>,
): string | null {
  const normalizedRawId = rawId.trim();
  if (!normalizedRawId) {
    return null;
  }

  const baseRawId = resolveOmpBaseModelRawId(normalizedRawId, discoveredModels);
  if (baseRawId === normalizedRawId || baseRawId.length >= normalizedRawId.length) {
    return null;
  }

  const variant = normalizedRawId.slice(baseRawId.length + 1).trim();
  return variant || null;
}

export function combineOmpRawModelSelection(
  baseRawId: string | null | undefined,
  thinkingLevel: string | null | undefined,
  discoveredModels: OmpDiscoveredModel[],
): string | null {
  const normalizedBaseRawId = baseRawId?.trim();
  if (!normalizedBaseRawId) {
    return null;
  }

  const variant = thinkingLevel?.trim();
  if (!variant || variant === OMP_DEFAULT_THINKING_LEVEL) {
    return normalizedBaseRawId;
  }

  const supportedVariants = new Set(
    getOmpModelVariants(normalizedBaseRawId, discoveredModels).map((entry) => entry.value),
  );
  return supportedVariants.has(variant)
    ? `${normalizedBaseRawId}/${variant}`
    : normalizedBaseRawId;
}

export function splitOmpModelLabel(label: string): {
  modelLabel: string;
  providerLabel: string;
} {
  const trimmed = label.trim();
  const slashIndex = trimmed.indexOf('/');
  if (slashIndex <= 0 || slashIndex >= trimmed.length - 1) {
    return {
      modelLabel: trimmed,
      providerLabel: 'Other',
    };
  }

  return {
    modelLabel: trimmed.slice(slashIndex + 1).trim(),
    providerLabel: trimmed.slice(0, slashIndex).trim(),
  };
}

export function buildOmpBaseModels(
  models: OmpDiscoveredModel[],
): OmpBaseModel[] {
  const discoveredRawIds = new Set(models.map((model) => model.rawId));
  const discoveredByRawId = new Map(models.map((model) => [model.rawId, model] as const));
  const grouped = new Map<string, OmpDiscoveredModel[]>();

  for (const model of models) {
    const baseRawId = resolveOmpBaseModelRawId(model.rawId, discoveredRawIds);
    const existing = grouped.get(baseRawId);
    if (existing) {
      existing.push(model);
    } else {
      grouped.set(baseRawId, [model]);
    }
  }

  return Array.from(grouped.entries())
    .map(([baseRawId, entries]) => {
      const baseModel = discoveredByRawId.get(baseRawId) ?? entries[0];
      const variants = entries.flatMap((entry) => {
        if (entry.rawId === baseRawId) {
          return [];
        }

        const variant = extractOmpModelVariantValue(entry.rawId, discoveredRawIds);
        if (!variant) {
          return [];
        }

        return [{
          ...(entry.description ? { description: entry.description } : {}),
          label: formatOmpThinkingLevelLabel(variant),
          value: variant,
        }];
      });

      return {
        ...(baseModel?.description ? { description: baseModel.description } : {}),
        label: baseModel?.label ?? baseRawId,
        rawId: baseRawId,
        variants: dedupeOmpVariants(variants),
      };
    })
    .sort((left, right) => left.label.localeCompare(right.label));
}

export function getOmpModelVariants(
  rawId: string,
  models: OmpDiscoveredModel[],
): OmpModelVariant[] {
  const baseRawId = resolveOmpBaseModelRawId(rawId, models);
  return buildOmpBaseModels(models)
    .find((model) => model.rawId === baseRawId)?.variants ?? [];
}

function formatOmpThinkingLevelLabel(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  if (trimmed.toLowerCase() === 'xhigh') {
    return 'XHigh';
  }

  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

export function groupOmpDiscoveredModels(
  models: OmpDiscoveredModel[],
): OmpDiscoveredModelGroup[] {
  const groups = new Map<string, OmpDiscoveredModelGroup>();
  for (const model of buildOmpBaseModels(models)) {
    const { providerLabel } = splitOmpModelLabel(model.label || model.rawId);
    const providerKey = providerLabel.toLowerCase();
    const existing = groups.get(providerKey);
    if (existing) {
      existing.models.push({
        ...(model.description ? { description: model.description } : {}),
        label: model.label,
        rawId: model.rawId,
      });
      continue;
    }

    groups.set(providerKey, {
      models: [{
        ...(model.description ? { description: model.description } : {}),
        label: model.label,
        rawId: model.rawId,
      }],
      providerKey,
      providerLabel,
    });
  }

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      models: [...group.models].sort((left, right) => left.label.localeCompare(right.label)),
    }))
    .sort((left, right) => left.providerLabel.localeCompare(right.providerLabel));
}

function dedupeOmpVariants(variants: OmpModelVariant[]): OmpModelVariant[] {
  const unique = new Map<string, OmpModelVariant>();
  for (const variant of variants) {
    if (!unique.has(variant.value)) {
      unique.set(variant.value, variant);
    }
  }

  return Array.from(unique.values())
    .sort((left, right) => compareOmpVariantValues(left.value, right.value));
}

function compareOmpVariantValues(left: string, right: string): number {
  const leftRank = OMP_VARIANT_ASCENDING_RANK.get(left.toLowerCase());
  const rightRank = OMP_VARIANT_ASCENDING_RANK.get(right.toLowerCase());

  if (leftRank !== undefined && rightRank !== undefined) {
    return leftRank - rightRank;
  }

  if (leftRank !== undefined) {
    return -1;
  }

  if (rightRank !== undefined) {
    return 1;
  }

  return left.localeCompare(right);
}
