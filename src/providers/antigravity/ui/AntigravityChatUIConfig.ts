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
 * `agy models` prints, so the launch spec passes it through verbatim. Keep in
 * sync with `agy models`.
 */
export const ANTIGRAVITY_MODEL_NAMES: readonly string[] = [
  'Gemini 3.6 Flash (Low)',
  'Gemini 3.6 Flash (Medium)',
  'Gemini 3.6 Flash (High)',
  'Gemini 3.5 Flash (Low)',
  'Gemini 3.5 Flash (Medium)',
  'Gemini 3.5 Flash (High)',
  'Gemini 3.1 Pro (Low)',
  'Gemini 3.1 Pro (High)',
  'Claude Sonnet 4.6 (Thinking)',
  'Claude Opus 4.6 (Thinking)',
  'GPT-OSS 120B (Medium)',
] as const;

const ANTIGRAVITY_MODEL_NAME_SET = new Set<string>(ANTIGRAVITY_MODEL_NAMES);

const ANTIGRAVITY_MODEL_OPTIONS: ProviderUIOption[] = [
  { value: ANTIGRAVITY_DEFAULT_MODEL_ID, label: 'Antigravity · Default' },
  ...ANTIGRAVITY_MODEL_NAMES.map((name) => ({ value: name, label: `Antigravity · ${name}` })),
];

/** True when a model value selects a specific agy model (not the synthetic default). */
export function isAntigravityModelName(model: string): boolean {
  return ANTIGRAVITY_MODEL_NAME_SET.has(model);
}

const DEFAULT_CONTEXT_WINDOW = 1_000_000;

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

  getContextWindowSize(): number {
    return DEFAULT_CONTEXT_WINDOW;
  },

  isDefaultModel(model: string): boolean {
    return model === ANTIGRAVITY_DEFAULT_MODEL_ID;
  },

  applyModelDefaults(_model: string, _settings: unknown): void {},

  normalizeModelVariant(model: string): string {
    return ANTIGRAVITY_MODEL_NAME_SET.has(model) ? model : ANTIGRAVITY_DEFAULT_MODEL_ID;
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
