import type { ProviderUIOption } from './types';

export type ModelEffortLevel =
  | 'off'
  | 'none'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max'
  | 'thinking'
  | 'ultracode';

export interface ModelEffortVariant {
  level: ModelEffortLevel;
  label: string;
  value: string;
}

export interface GroupedModelOption {
  familyKey: string;
  familyLabel: string;
  description?: string;
  group?: string;
  providerId?: string;
  providerIcon?: ProviderUIOption['providerIcon'];
  isDefault?: boolean;
  variants: ModelEffortVariant[];
  primaryValue: string;
}

const EFFORT_RE = /\s*\((None|Off|Minimal|Low|Medium|High|XHigh|Max|Thinking|Ultracode)\)\s*$/i;
const EFFORT_ORDER: ModelEffortLevel[] = [
  'off',
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'thinking',
  'ultracode',
];

function asLevel(raw: string): ModelEffortLevel {
  const lower = raw.toLowerCase();
  switch (lower) {
    case 'off':
    case 'none':
    case 'minimal':
    case 'low':
    case 'medium':
    case 'high':
    case 'xhigh':
    case 'max':
    case 'thinking':
    case 'ultracode':
      return lower;
    default:
      return 'medium';
  }
}

export function parseModelEffort(value: string, label = value): {
  family: string;
  level: ModelEffortLevel | null;
  effortLabel: string | null;
} {
  const source = value || label;
  const match = source.match(EFFORT_RE);
  if (!match) {
    return { family: label.replace(/^.*·\s*/, '').trim() || value, level: null, effortLabel: null };
  }
  const family = source.slice(0, match.index).replace(/^.*·\s*/, '').trim();
  const rawEffort = match[1];
  const effortLabel = rawEffort.toLowerCase() === 'xhigh'
    ? 'XHigh'
    : rawEffort.charAt(0).toUpperCase() + rawEffort.slice(1).toLowerCase();

  return {
    family,
    level: asLevel(rawEffort),
    effortLabel,
  };
}

function preferredPrimary(variants: ModelEffortVariant[]): string {
  return variants.find((variant) => variant.level === 'high')?.value
    ?? variants.find((variant) => variant.level === 'medium')?.value
    ?? variants.find((variant) => variant.level === 'max')?.value
    ?? variants.find((variant) => variant.level === 'xhigh')?.value
    ?? variants[variants.length - 1]?.value
    ?? '';
}

/** Collapses effort variant siblings into one picker row. */
export function groupModelOptions(models: readonly ProviderUIOption[]): GroupedModelOption[] {
  const groups = new Map<string, GroupedModelOption>();

  for (const model of models) {
    const { family, level, effortLabel } = parseModelEffort(model.value, model.label);
    const key = `${model.providerId ?? model.group ?? ''}::${family}`;
    const existing = groups.get(key);

    if (!existing) {
      groups.set(key, {
        familyKey: key,
        familyLabel: family,
        description: model.description,
        group: model.group,
        providerId: model.providerId,
        providerIcon: model.providerIcon,
        isDefault: model.isDefault,
        variants: level && effortLabel ? [{ level, label: effortLabel, value: model.value }] : [],
        primaryValue: model.value,
      });
      continue;
    }

    if (level && effortLabel && !existing.variants.some((v) => v.value === model.value)) {
      existing.variants.push({ level, label: effortLabel, value: model.value });
      existing.variants.sort(
        (a, b) => EFFORT_ORDER.indexOf(a.level) - EFFORT_ORDER.indexOf(b.level),
      );
      existing.primaryValue = preferredPrimary(existing.variants);
    }
    if (model.isDefault) {
      existing.isDefault = true;
    }
    if (!existing.description && model.description) {
      existing.description = model.description;
    }
  }

  return Array.from(groups.values());
}
