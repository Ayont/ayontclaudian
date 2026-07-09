import type { ProviderUIOption } from '../../../core/providers/types';

export type CodexModel = string;

export const CODEX_SPARK_MODEL: CodexModel = 'gpt-5.3-codex-spark';
export const CODEX_GPT_56_SOL_MODEL: CodexModel = 'gpt-5.6-sol';
export const CODEX_GPT_56_TERRA_MODEL: CodexModel = 'gpt-5.6-terra';
export const CODEX_GPT_56_LUNA_MODEL: CodexModel = 'gpt-5.6-luna';
export const DEFAULT_CODEX_MINI_MODEL: CodexModel = 'gpt-5.4-mini';
export const CODEX_GPT_55_MODEL: CodexModel = 'gpt-5.5';
export const DEFAULT_CODEX_PRIMARY_MODEL: CodexModel = CODEX_GPT_56_SOL_MODEL;
export const FAST_TIER_CODEX_MODELS = new Set<CodexModel>([
  CODEX_GPT_56_SOL_MODEL,
  CODEX_GPT_56_TERRA_MODEL,
  CODEX_GPT_56_LUNA_MODEL,
  CODEX_GPT_55_MODEL,
]);

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

function createCodexModelOption(model: CodexModel, description: string): ProviderUIOption {
  return {
    value: model,
    label: formatCodexModelLabel(model),
    description,
  };
}

export const DEFAULT_CODEX_MINI_MODEL_LABEL = formatCodexModelLabel(DEFAULT_CODEX_MINI_MODEL);
export const DEFAULT_CODEX_PRIMARY_MODEL_LABEL = formatCodexModelLabel(DEFAULT_CODEX_PRIMARY_MODEL);
export const FAST_TIER_CODEX_MODEL_LABEL = 'supported GPT-5.6/GPT-5.5 models';
export const FAST_TIER_CODEX_DESCRIPTION = `Enable ${FAST_TIER_CODEX_MODEL_LABEL} fast mode for this conversation. Faster responses use more credits.`;

export const DEFAULT_CODEX_MODELS: ProviderUIOption[] = [
  createCodexModelOption(CODEX_GPT_56_SOL_MODEL, 'Flagship GPT-5.6 model for complex coding'),
  createCodexModelOption(CODEX_GPT_56_TERRA_MODEL, 'Balanced GPT-5.6 model for everyday work'),
  createCodexModelOption(CODEX_GPT_56_LUNA_MODEL, 'Fast and cost-efficient GPT-5.6 model'),
  createCodexModelOption(CODEX_GPT_55_MODEL, 'Previous frontier model'),
  createCodexModelOption(DEFAULT_CODEX_MINI_MODEL, 'Fast legacy mini model'),
];

export const DEFAULT_CODEX_MODEL_SET = new Set(DEFAULT_CODEX_MODELS.map(model => model.value));

export function isCodexGpt56Model(model: string): boolean {
  return model === CODEX_GPT_56_SOL_MODEL
    || model === CODEX_GPT_56_TERRA_MODEL
    || model === CODEX_GPT_56_LUNA_MODEL;
}

export function supportsCodexFastTier(model: string | undefined): boolean {
  return !!model && FAST_TIER_CODEX_MODELS.has(model);
}

export function supportsCodexMaxEffort(model: string): boolean {
  return isCodexGpt56Model(model);
}

export function supportsCodexUltraEffort(model: string): boolean {
  return model === CODEX_GPT_56_SOL_MODEL || model === CODEX_GPT_56_TERRA_MODEL;
}

export function getCodexModelContextWindow(model: string): number {
  return isCodexGpt56Model(model) ? CODEX_GPT_56_CONTEXT_WINDOW : DEFAULT_CODEX_CONTEXT_WINDOW;
}
