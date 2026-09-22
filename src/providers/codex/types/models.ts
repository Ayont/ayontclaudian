import type { ProviderUIOption } from '../../../core/providers/types';

export type CodexModel = string;

export const CODEX_SPARK_MODEL: CodexModel = 'gpt-5.3-codex-spark';
export const CODEX_GPT_6_ASTRA_MODEL: CodexModel = 'gpt-6-astra';
export const CODEX_GPT_6_SOL_MODEL: CodexModel = 'gpt-6-sol';
export const CODEX_GPT_6_LUNA_MODEL: CodexModel = 'gpt-6-luna';
export const CODEX_GPT_56_SOL_MODEL: CodexModel = 'gpt-5.6-sol';
export const CODEX_GPT_56_TERRA_MODEL: CodexModel = 'gpt-5.6-terra';
export const CODEX_GPT_56_LUNA_MODEL: CodexModel = 'gpt-5.6-luna';
export const CODEX_GPT_55_MODEL: CodexModel = 'gpt-5.5';
// codex-cli 0.155.1's catalog names gpt-6-sol as the `upgrade` of gpt-5.6-sol.
// Only unset and unavailable selections land here; an explicit 5.6 pick stays.
export const DEFAULT_CODEX_PRIMARY_MODEL: CodexModel = CODEX_GPT_6_SOL_MODEL;
export const FAST_TIER_CODEX_MODELS = new Set<CodexModel>([
  CODEX_GPT_6_ASTRA_MODEL,
  CODEX_GPT_6_SOL_MODEL,
  CODEX_GPT_6_LUNA_MODEL,
  CODEX_GPT_56_SOL_MODEL,
  CODEX_GPT_56_TERRA_MODEL,
  CODEX_GPT_56_LUNA_MODEL,
  CODEX_GPT_55_MODEL,
]);

// codex-cli 0.153.2 reports 258,400 usable tokens (272,000 at 95%) for Astra
// by default, verified with a live turn on 2026-09-04. In 0.155.1's catalog
// every served model carries that row (context_window 272000, 95% effective):
// GPT-6, GPT-5.6 and GPT-5.5. The 1,050,000 once assumed for GPT-5.6 was never
// in it. Live usage takes precedence after the first turn.
export const CODEX_CATALOG_CONTEXT_WINDOW = 258_400;
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

export const DEFAULT_CODEX_PRIMARY_MODEL_LABEL = formatCodexModelLabel(DEFAULT_CODEX_PRIMARY_MODEL);
export const FAST_TIER_CODEX_MODEL_LABEL = 'GPT-6-Modelle sowie unterstützte GPT-5.6-/GPT-5.5-Modelle';
export const FAST_TIER_CODEX_DESCRIPTION = `Fast-Modus für ${FAST_TIER_CODEX_MODEL_LABEL} in dieser Unterhaltung aktivieren. Schnellere Antworten verbrauchen mehr Credits.`;

// The default must come first: resolveCodexModelSelection falls back to the
// first available option, not to DEFAULT_CODEX_PRIMARY_MODEL.
// "Nachfolger" follows each model's `upgrade` in app-server `model/list` (0.155.1).
export const DEFAULT_CODEX_MODELS: ProviderUIOption[] = [
  createCodexModelOption(
    CODEX_GPT_6_SOL_MODEL,
    'Neues Sol: Alltagsmodell für komplexe Aufgaben und Coding, schont die Nutzungslimits',
  ),
  createCodexModelOption(
    CODEX_GPT_6_ASTRA_MODEL,
    'Leistungsfähigstes OpenAI-Modell für komplexe, anspruchsvolle Aufgaben',
  ),
  createCodexModelOption(CODEX_GPT_6_LUNA_MODEL, 'Neue Luna: sehr effizient für alles ohne Frontier-Anspruch'),
  createCodexModelOption(CODEX_GPT_56_SOL_MODEL, 'Vorheriges Sol-Modell für komplexes Coding · Nachfolger: GPT-6 Sol'),
  createCodexModelOption(CODEX_GPT_56_TERRA_MODEL, 'Ausgewogenes GPT-5.6-Modell für den Alltag · Nachfolger: GPT-6 Sol'),
  createCodexModelOption(CODEX_GPT_56_LUNA_MODEL, 'Vorheriges Luna-Modell, schnell und günstig · Nachfolger: GPT-6 Luna'),
  createCodexModelOption(CODEX_GPT_55_MODEL, 'Älteres Frontier-Modell · Nachfolger: GPT-5.6 Sol'),
];

export const DEFAULT_CODEX_MODEL_SET = new Set(DEFAULT_CODEX_MODELS.map(model => model.value));

export function isCodexGpt6Model(model: string): boolean {
  return model === CODEX_GPT_6_ASTRA_MODEL
    || model === CODEX_GPT_6_SOL_MODEL
    || model === CODEX_GPT_6_LUNA_MODEL;
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

// Mirrors each catalog row's supported_reasoning_levels: the Luna rows stop at max.
export function supportsCodexUltraEffort(model: string): boolean {
  return model === CODEX_GPT_6_ASTRA_MODEL
    || model === CODEX_GPT_6_SOL_MODEL
    || model === CODEX_GPT_56_SOL_MODEL
    || model === CODEX_GPT_56_TERRA_MODEL;
}

export function getCodexModelContextWindow(model: string): number {
  if (isCodexGpt6Model(model) || isCodexGpt56Model(model) || model === CODEX_GPT_55_MODEL) {
    return CODEX_CATALOG_CONTEXT_WINDOW;
  }
  return DEFAULT_CODEX_CONTEXT_WINDOW;
}
