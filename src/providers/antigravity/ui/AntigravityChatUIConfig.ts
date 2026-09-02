import type {
  ProviderChatUIConfig,
  ProviderPermissionModeToggleConfig,
  ProviderReasoningOption,
  ProviderUIOption,
} from '../../../core/providers/types';
import { ANTIGRAVITY_PROVIDER_ICON } from '../../../shared/icons';
import { getAntigravityProviderSettings, updateAntigravityProviderSettings } from '../settings';

/**
 * Multi-model chat UI config for Antigravity.
 *
 * agy ≥ 1.0.9 exposes `--model "<name>"` and lists choices via `agy models`.
 * The selector offers a synthetic "Default" entry (lets agy use its configured
 * default, no flag) plus every model agy reports. Reasoning effort is baked into
 * the model name (e.g. "(Low)/(Medium)/(High)/(Thinking)"), so the separate
 * reasoning control stays empty (capabilities.reasoningControl === 'none').
 */
export const ANTIGRAVITY_DEFAULT_MODEL_ID = 'antigravity-default';

/**
 * Models selectable via `agy --model "<name>"`. The VALUE is the EXACT name
 * `agy models` prints, so the launch spec passes it through verbatim.
 *
 * Mirror of `agy models` on agy 1.1.24 (run, not assumed). Gemini 3.8 Flash is
 * new; Gemini 3.5 Flash was dropped by agy and is migrated below so a persisted
 * 3.5 value never reaches `--model` and fails the turn.
 */
export const ANTIGRAVITY_MODEL_NAMES: readonly string[] = [
  'Gemini 3.8 Flash (Low)',
  'Gemini 3.8 Flash (Medium)',
  'Gemini 3.8 Flash (High)',
  'Gemini 3.7 Flash (Low)',
  'Gemini 3.7 Flash (Medium)',
  'Gemini 3.7 Flash (High)',
  'Gemini 3.6 Flash (Low)',
  'Gemini 3.6 Flash (Medium)',
  'Gemini 3.6 Flash (High)',
  'Gemini 3.1 Pro (Low)',
  'Gemini 3.1 Pro (High)',
  'Claude Sonnet 4.6 (Thinking)',
  'Claude Opus 4.6 (Thinking)',
  'GPT-OSS 120B (Medium)',
] as const;

/** Stable slugs from `agy models` (agy >= 1.1.5). Both slug and display name are valid `--model` values. */
const ANTIGRAVITY_MODEL_SLUGS: Readonly<Record<string, string>> = Object.freeze({
  'gemini-3.8-flash-high': 'Gemini 3.8 Flash (High)',
  'gemini-3.8-flash-medium': 'Gemini 3.8 Flash (Medium)',
  'gemini-3.8-flash-low': 'Gemini 3.8 Flash (Low)',
  'gemini-3.7-flash-high': 'Gemini 3.7 Flash (High)',
  'gemini-3.7-flash-medium': 'Gemini 3.7 Flash (Medium)',
  'gemini-3.7-flash-low': 'Gemini 3.7 Flash (Low)',
  'gemini-3.6-flash-high': 'Gemini 3.6 Flash (High)',
  'gemini-3.6-flash-medium': 'Gemini 3.6 Flash (Medium)',
  'gemini-3.6-flash-low': 'Gemini 3.6 Flash (Low)',
  'gemini-3.1-pro-high': 'Gemini 3.1 Pro (High)',
  'gemini-3.1-pro-low': 'Gemini 3.1 Pro (Low)',
  'claude-sonnet-4-6': 'Claude Sonnet 4.6 (Thinking)',
  'claude-opus-4-6-thinking': 'Claude Opus 4.6 (Thinking)',
  'gpt-oss-120b-medium': 'GPT-OSS 120B (Medium)',
});

const ANTIGRAVITY_MODEL_NAME_SET = new Set<string>([
  ...ANTIGRAVITY_MODEL_NAMES,
  ...Object.keys(ANTIGRAVITY_MODEL_SLUGS),
]);

/**
 * Gemini Flash generations agy no longer serves. A persisted value from an older
 * build maps onto the newest Flash generation at the SAME reasoning tier, in the
 * same spelling (display name stays a name, slug stays a slug). Without this the
 * generic fallback would silently reset the user to "Default".
 */
const RETIRED_GEMINI_FLASH_GENERATIONS = ['3.5'] as const;
const CURRENT_GEMINI_FLASH_GENERATION = '3.8';

function migrateRetiredAntigravityModel(model: string): string {
  for (const generation of RETIRED_GEMINI_FLASH_GENERATIONS) {
    const namePrefix = `Gemini ${generation} Flash`;
    if (model.startsWith(namePrefix)) {
      return `Gemini ${CURRENT_GEMINI_FLASH_GENERATION} Flash${model.slice(namePrefix.length)}`;
    }
    const slugPrefix = `gemini-${generation}-flash`;
    if (model.startsWith(slugPrefix)) {
      return `gemini-${CURRENT_GEMINI_FLASH_GENERATION}-flash${model.slice(slugPrefix.length)}`;
    }
  }
  return model;
}

const ANTIGRAVITY_MODEL_OPTIONS: ProviderUIOption[] = [
  { value: ANTIGRAVITY_DEFAULT_MODEL_ID, label: 'Antigravity · Default' },
  ...ANTIGRAVITY_MODEL_NAMES.map((name) => ({ value: name, label: `Antigravity · ${name}` })),
];

/** True when a model value selects a specific agy model (not the synthetic default). */
export function isAntigravityModelName(model: string): boolean {
  return ANTIGRAVITY_MODEL_NAME_SET.has(model);
}

const DEFAULT_CONTEXT_WINDOW = 1_000_000;

/**
 * Per-model context windows. The model list above deliberately spans three
 * vendors, so a single flat window mis-scales the usage badge: at ~120K estimated
 * tokens GPT-OSS 120B was showing 12% full when it is actually near its limit.
 *
 * Keyed by name prefix so the reasoning-level suffix ("(Low)", "(Medium)",
 * "(High)", "(Thinking)") doesn't need its own entry. Anything unmatched falls
 * back to DEFAULT_CONTEXT_WINDOW — correct for the Gemini 3.x and Claude 4.6
 * entries, which are all 1M per their vendors' own model docs.
 *
 * stream-json now reports token counts; the window itself is still local
 * (agy does not send a context-window field). Keep in sync with ANTIGRAVITY_MODEL_NAMES.
 */
const ANTIGRAVITY_CONTEXT_WINDOWS: readonly (readonly [string, number])[] = [
  ['GPT-OSS 120B', 131_072],
] as const;

/** Context window for an exact `agy models` name or slug, or the 1M default. */
export function getAntigravityContextWindow(model: string): number {
  if (!model) return DEFAULT_CONTEXT_WINDOW;
  const resolved = ANTIGRAVITY_MODEL_SLUGS[model] ?? model;
  for (const [prefix, window] of ANTIGRAVITY_CONTEXT_WINDOWS) {
    if (resolved.startsWith(prefix)) return window;
  }
  return DEFAULT_CONTEXT_WINDOW;
}

// agy has no plan mode, so the toolbar control is a two-state YOLO <-> Sandbox
// toggle (no `planValue`). YOLO is the active/default posture because `--print`
// is non-interactive and cannot answer permission prompts; Sandbox is opt-in.
const ANTIGRAVITY_PERMISSION_MODE_TOGGLE: ProviderPermissionModeToggleConfig = {
  inactiveValue: 'sandbox',
  inactiveLabel: 'Sandbox',
  activeValue: 'yolo',
  activeLabel: 'YOLO',
};

function asSettingsBag(settings: unknown): Record<string, unknown> | null {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return null;
  }
  return settings as Record<string, unknown>;
}

export const antigravityChatUIConfig: ProviderChatUIConfig = {
  getModelOptions(_settings: Record<string, unknown>): ProviderUIOption[] {
    return [...ANTIGRAVITY_MODEL_OPTIONS];
  },

  getProviderIcon() {
    return ANTIGRAVITY_PROVIDER_ICON;
  },

  ownsModel(model: string): boolean {
    return model === ANTIGRAVITY_DEFAULT_MODEL_ID || ANTIGRAVITY_MODEL_NAME_SET.has(model);
  },

  isAdaptiveReasoningModel(): boolean {
    return false;
  },

  getReasoningOptions(): ProviderReasoningOption[] {
    return [];
  },

  getDefaultReasoningValue(): string {
    return '';
  },

  getContextWindowSize(model: string, customLimits?: Record<string, number>): number {
    const custom = customLimits?.[model];
    if (typeof custom === 'number' && custom > 0 && isFinite(custom)) return custom;
    return getAntigravityContextWindow(ANTIGRAVITY_MODEL_SLUGS[model] ?? model);
  },

  isDefaultModel(model: string): boolean {
    return model === ANTIGRAVITY_DEFAULT_MODEL_ID;
  },

  applyModelDefaults(_model: string, _settings: unknown): void {},

  normalizeModelVariant(model: string): string {
    if (ANTIGRAVITY_MODEL_NAME_SET.has(model)) return model;
    const migrated = migrateRetiredAntigravityModel(model);
    return ANTIGRAVITY_MODEL_NAME_SET.has(migrated) ? migrated : ANTIGRAVITY_DEFAULT_MODEL_ID;
  },

  getCustomModelIds(): Set<string> {
    return new Set<string>();
  },

  getPermissionModeToggle(): ProviderPermissionModeToggleConfig {
    return ANTIGRAVITY_PERMISSION_MODE_TOGGLE;
  },

  resolvePermissionMode(settings: Record<string, unknown>): string | null {
    return getAntigravityProviderSettings(settings).permissionMode;
  },

  applyPermissionMode(value: string, settings: unknown): void {
    const bag = asSettingsBag(settings);
    if (!bag) {
      return;
    }
    const mode = value === 'sandbox' ? 'sandbox' : 'yolo';
    bag.permissionMode = mode;
    updateAntigravityProviderSettings(bag, { permissionMode: mode });
  },
};
