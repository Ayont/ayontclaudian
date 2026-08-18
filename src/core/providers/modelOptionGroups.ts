import type { ProviderUIOption } from './types';

export type ModelEffortLevel = 'low' | 'medium' | 'high' | 'thinking';

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

const EFFORT_RE = /\s*\((Low|Medium|High|Thinking)\)\s*$/i;
const EFFORT_ORDER: ModelEffortLevel[] = ['low', 'medium', 'high', 'thinking'];

function asLevel(raw: string): ModelEffortLevel {
  const lower = raw.toLowerCase();
  if (lower === 'low' || lower === 'medium' || lower === 'high' || lower === 'thinking') {
    return lower;
  }
  return 'medium';
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
  return {
    family,
    level: asLevel(match[1]),
    effortLabel: match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase(),
  };
}

function preferredPrimary(variants: ModelEffortVariant[]): string {
  return variants.find((variant) => variant.level === 'high')?.value
    ?? variants.find((variant) => variant.level === 'medium')?.value
    ?? variants[variants.length - 1]?.value
    ?? '';
}

/** Collapses Low/Medium/High/Thinking siblings into one picker row. */
export function groupModelOptions(models: readonly ProviderUIOption[]): GroupedModelOption[] {
  const groups = new Map<string, { option: GroupedModelOption; seen: Set<string> }>();
  const order: string[] = [];

  for (const model of models) {
    const parsed = parseModelEffort(model.value, model.label);
    const familyKey = `${model.providerId ?? ''}::${parsed.family}`;
    let entry = groups.get(familyKey);
    if (!entry) {
      entry = {
        seen: new Set(),
        option: {
          familyKey,
          familyLabel: parsed.family,
          description: model.description,
          group: model.group,
          providerId: model.providerId,
          providerIcon: model.providerIcon,
          isDefault: model.isDefault,
          variants: [],
          primaryValue: model.value,
        },
      };
      groups.set(familyKey, entry);
      order.push(familyKey);
    }

    if (parsed.level && parsed.effortLabel && !entry.seen.has(parsed.level)) {
      entry.seen.add(parsed.level);
      entry.option.variants.push({
        level: parsed.level,
        label: parsed.effortLabel,
        value: model.value,
      });
    }
    if (model.isDefault) entry.option.isDefault = true;
    if (model.description && !entry.option.description) entry.option.description = model.description;
  }

  return order.map((key) => {
    const option = groups.get(key)!.option;
    option.variants.sort((a, b) => EFFORT_ORDER.indexOf(a.level) - EFFORT_ORDER.indexOf(b.level));
    if (option.variants.length === 1) {
      option.variants = [];
    }
    if (option.variants.length > 1) {
      option.primaryValue = preferredPrimary(option.variants);
    }
    return option;
  });
}
