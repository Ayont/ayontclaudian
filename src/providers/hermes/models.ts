/**
 * Hermes model identity.
 *
 * Hermes' ACP server reports its whole authenticated catalog through
 * `session/new`.`models` — one entry per provider/model pair, with the wire id
 * shaped `<provider>:<model>` (e.g. `openrouter:anthropic/claude-opus-5`).
 * That id round-trips unchanged through `session/set_model`, so Claudian
 * stores it verbatim as the "raw id" and only wraps it in a `hermes:` prefix
 * to keep provider ownership decidable in the shared model picker.
 */

export interface HermesDiscoveredModel {
  description?: string;
  label: string;
  rawId: string;
}

export interface HermesDiscoveredModelGroup {
  models: HermesDiscoveredModel[];
  providerKey: string;
  providerLabel: string;
}

export const HERMES_SYNTHETIC_MODEL_ID = 'hermes';

const HERMES_MODEL_PREFIX = 'hermes:';

export function isHermesModelSelectionId(model: string): boolean {
  return model === HERMES_SYNTHETIC_MODEL_ID || model.startsWith(HERMES_MODEL_PREFIX);
}

export function encodeHermesModelId(rawModelId: string): string {
  const normalized = rawModelId.trim();
  return normalized ? `${HERMES_MODEL_PREFIX}${normalized}` : HERMES_SYNTHETIC_MODEL_ID;
}

export function decodeHermesModelId(model: string): string | null {
  if (!model.startsWith(HERMES_MODEL_PREFIX)) {
    return null;
  }

  const rawModelId = model.slice(HERMES_MODEL_PREFIX.length).trim();
  return rawModelId || null;
}

export function normalizeHermesDiscoveredModels(value: unknown): HermesDiscoveredModel[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized: HermesDiscoveredModel[] = [];
  const seen = new Set<string>();
  for (const entry of value as unknown[]) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      continue;
    }

    const record = entry as Record<string, unknown>;
    const rawId = typeof record.rawId === 'string' ? record.rawId.trim() : '';
    if (!rawId || seen.has(rawId)) {
      continue;
    }

    const label = typeof record.label === 'string' ? record.label.trim() : '';
    const description = typeof record.description === 'string' ? record.description.trim() : '';

    seen.add(rawId);
    normalized.push({
      ...(description ? { description } : {}),
      label: label || rawId,
      rawId,
    });
  }

  return normalized;
}

/**
 * Splits a raw id into its Hermes inference provider and the model itself.
 * Named endpoints keep their `custom:<name>` prefix intact, which is why the
 * split is anchored on the LAST colon that still leaves a non-empty model.
 */
export function splitHermesRawModelId(rawId: string): {
  modelId: string;
  providerId: string;
} {
  const trimmed = rawId.trim();
  const separatorIndex = trimmed.lastIndexOf(':');
  if (separatorIndex <= 0 || separatorIndex >= trimmed.length - 1) {
    return { modelId: trimmed, providerId: '' };
  }

  return {
    modelId: trimmed.slice(separatorIndex + 1).trim(),
    providerId: trimmed.slice(0, separatorIndex).trim(),
  };
}

/**
 * Display label for a model row. Hermes already sends `"<Provider> · <model>"`
 * for canonical providers, so the raw-id split is only the fallback for named
 * endpoints and for models that are configured but no longer reported.
 */
export function describeHermesModel(model: HermesDiscoveredModel): {
  modelLabel: string;
  providerLabel: string;
} {
  const separatorIndex = model.label.indexOf(' · ');
  if (separatorIndex > 0) {
    return {
      modelLabel: model.label.slice(separatorIndex + 3).trim() || model.rawId,
      providerLabel: model.label.slice(0, separatorIndex).trim(),
    };
  }

  const { modelId, providerId } = splitHermesRawModelId(model.rawId);
  return {
    modelLabel: model.label.trim() || modelId || model.rawId,
    providerLabel: providerId || 'Other',
  };
}

export function groupHermesDiscoveredModels(
  models: HermesDiscoveredModel[],
): HermesDiscoveredModelGroup[] {
  const groups = new Map<string, HermesDiscoveredModelGroup>();

  for (const model of models) {
    const { providerLabel } = describeHermesModel(model);
    const providerKey = providerLabel.toLowerCase();
    const existing = groups.get(providerKey);
    if (existing) {
      existing.models.push({ ...model });
      continue;
    }

    groups.set(providerKey, {
      models: [{ ...model }],
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
