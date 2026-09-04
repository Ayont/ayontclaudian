import type { ProviderUIOption } from '../../../core/providers/types';

export type CodexModel = string;

export const CODEX_SPARK_MODEL: CodexModel = 'gpt-5.3-codex-spark';
export const CODEX_GPT_6_ASTRA_MODEL: CodexModel = 'gpt-6-astra';
export const CODEX_GPT_56_SOL_MODEL: CodexModel = 'gpt-5.6-sol';
export const CODEX_GPT_56_TERRA_MODEL: CodexModel = 'gpt-5.6-terra';
export const CODEX_GPT_56_LUNA_MODEL: CodexModel = 'gpt-5.6-luna';
export const DEFAULT_CODEX_MINI_MODEL: CodexModel = 'gpt-5.4-mini';
export const CODEX_GPT_55_MODEL: CodexModel = 'gpt-5.5';
export const DEFAULT_CODEX_PRIMARY_MODEL: CodexModel = CODEX_GPT_56_SOL_MODEL;
export const FAST_TIER_CODEX_MODELS = new Set<CodexModel>([
  CODEX_GPT_6_ASTRA_MODEL,
  CODEX_GPT_56_SOL_MODEL,
  CODEX_GPT_56_TERRA_MODEL,
  CODEX_GPT_56_LUNA_MODEL,
  CODEX_GPT_55_MODEL,
]);

// codex-cli 0.153.2 reports 258,400 usable tokens (272,000 at 95%) for Astra
// by default, verified with a live turn on 2026-09-04. Live usage takes precedence.
export const CODEX_GPT_6_CONTEXT_WINDOW = 258_400;
export const CODEX_GPT_56_CONTEXT_WINDOW = 1_050_000;
export const DEFAULT_CODEX_CONTEXT_WINDOW = 200_000;

function formatCodexModelSuffix(suffix: string): string {
  return suffix
    .split('-')
    .filter(Boolean)
    .map(segment => segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase())
    .join(' ');
}

export function formatCodexModelLabel(model: string): string {
  const match = model.match(/^gpt-([^-]+)(?:-(.+))?$/i);
  if (!match) {
    return model;
  }

  const [, version, suffix] = match;
  return `GPT-${version}${suffix ? ` ${formatCodexModelSuffix(suffix)}` : ''}`;
}

function createCodexModelOption(
  model: CodexModel,
  description: string,
): ProviderUIOption {
  return {
    value: model,
    label: formatCodexModelLabel(model),
    description,
  };
}

export const DEFAULT_CODEX_MINI_MODEL_LABEL = formatCodexModelLabel(DEFAULT_CODEX_MINI_MODEL);
export const DEFAULT_CODEX_PRIMARY_MODEL_LABEL = formatCodexModelLabel(DEFAULT_CODEX_PRIMARY_MODEL);
export const FAST_TIER_CODEX_MODEL_LABEL = 'GPT-6 Astra und unterstützte GPT-5.6-/GPT-5.5-Modelle';
export const FAST_TIER_CODEX_DESCRIPTION = `Fast-Modus für ${FAST_TIER_CODEX_MODEL_LABEL} in dieser Unterhaltung aktivieren. Schnellere Antworten verbrauchen mehr Credits.`;

export const DEFAULT_CODEX_MODELS: ProviderUIOption[] = [
  createCodexModelOption(CODEX_GPT_56_SOL_MODEL, 'Flagship GPT-5.6 model for complex coding'),
  createCodexModelOption(
    CODEX_GPT_6_ASTRA_MODEL,
    'Leistungsfähigstes OpenAI-Modell für komplexe, anspruchsvolle Aufgaben',
  ),
  createCodexModelOption(CODEX_GPT_56_TERRA_MODEL, 'Balanced GPT-5.6 model for everyday work'),
  createCodexModelOption(CODEX_GPT_56_LUNA_MODEL, 'Fast and cost-efficient GPT-5.6 model'),
  createCodexModelOption(CODEX_GPT_55_MODEL, 'Previous frontier model'),
  createCodexModelOption(DEFAULT_CODEX_MINI_MODEL, 'Fast legacy mini model'),
];

export const DEFAULT_CODEX_MODEL_SET = new Set(DEFAULT_CODEX_MODELS.map(model => model.value));

export function isCodexGpt6Model(model: string): boolean {
  return model === CODEX_GPT_6_ASTRA_MODEL;
}

export function isCodexGpt56Model(model: string): boolean {
  return model === CODEX_GPT_56_SOL_MODEL
    || model === CODEX_GPT_56_TERRA_MODEL
    || model === CODEX_GPT_56_LUNA_MODEL;
}

export function supportsCodexFastTier(model: string | undefined): boolean {
  return !!model && FAST_TIER_CODEX_MODELS.has(model);
}

export function supportsCodexMaxEffort(model: string): boolean {
  return isCodexGpt6Model(model) || isCodexGpt56Model(model);
}

export function supportsCodexUltraEffort(model: string): boolean {
  return model === CODEX_GPT_6_ASTRA_MODEL || model === CODEX_GPT_56_SOL_MODEL || model === CODEX_GPT_56_TERRA_MODEL;
}

export function getCodexModelContextWindow(model: string): number {
  if (model === CODEX_GPT_6_ASTRA_MODEL) return CODEX_GPT_6_CONTEXT_WINDOW;
  return isCodexGpt56Model(model) ? CODEX_GPT_56_CONTEXT_WINDOW : DEFAULT_CODEX_CONTEXT_WINDOW;
}
