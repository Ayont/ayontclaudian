import type { ProviderUIOption } from '../../../core/providers/types';
import { CLINE_PROVIDER_ICON } from '../../../shared/icons';

/**
 * Official Cline / ClinePass catalog.
 *
 * Model ids and context windows come from `@cline/llms` (shipped with `cline`
 * 3.0.54) and the ClinePass docs — not guessed. CLI invocation is:
 *
 *     cline -P cline-pass -m cline-pass/kimi-k3
 *
 * The namespaced id is what the CLI writes into session metadata.
 */
export type ClineModelId = string;

export type ClineApiProviderId =
  | 'cline-pass'
  | 'cline'
  | 'anthropic'
  | 'openai'
  | 'openai-codex'
  | 'openrouter'
  | 'gemini'
  | 'bedrock';

export type ClineThinkingLevel = 'none' | 'low' | 'medium' | 'high' | 'xhigh';

export interface ClineModelMeta {
  id: ClineModelId;
  label: string;
  description: string;
  contextWindow: number;
  supportsImages: boolean;
  group: string;
  apiProvider: ClineApiProviderId;
}

/** Official ClinePass default (`@cline/llms` `defaultModelId`). */
export const DEFAULT_CLINE_PRIMARY_MODEL: ClineModelId = 'cline-pass/kimi-k3';

/** Fallback window for unknown / custom ids. */
export const DEFAULT_CLINE_CONTEXT_WINDOW = 262_144;

export const CLINE_THINKING_LEVELS: readonly ClineThinkingLevel[] = [
  'none',
  'low',
  'medium',
  'high',
  'xhigh',
];

export const CLINE_API_PROVIDERS: readonly { id: ClineApiProviderId; label: string }[] = [
  { id: 'cline-pass', label: 'ClinePass' },
  { id: 'cline', label: 'Cline (Usage)' },
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'openai-codex', label: 'ChatGPT Subscription' },
  { id: 'openrouter', label: 'OpenRouter' },
  { id: 'gemini', label: 'Google Gemini' },
  { id: 'bedrock', label: 'AWS Bedrock' },
];

export const CLINE_PASS_MODELS: readonly ClineModelMeta[] = [
  {
    id: 'cline-pass/kimi-k3',
    label: 'Kimi K3',
    description: 'Frontier · 1M · multimodal · ClinePass',
    contextWindow: 1_048_576,
    supportsImages: true,
    group: 'ClinePass',
    apiProvider: 'cline-pass',
  },
  {
    id: 'cline-pass/glm-5.2',
    label: 'GLM-5.2',
    description: 'Deep reasoning · 1M · ClinePass',
    contextWindow: 1_048_576,
    supportsImages: false,
    group: 'ClinePass',
    apiProvider: 'cline-pass',
  },
  {
    id: 'cline-pass/kimi-k2.7-code',
    label: 'Kimi K2.7 Code',
    description: 'Coding · 256K · multimodal · ClinePass',
    contextWindow: 262_144,
    supportsImages: true,
    group: 'ClinePass',
    apiProvider: 'cline-pass',
  },
  {
    id: 'cline-pass/kimi-k2.6',
    label: 'Kimi K2.6',
    description: 'Agentisch · 256K · multimodal · ClinePass',
    contextWindow: 262_144,
    supportsImages: true,
    group: 'ClinePass',
    apiProvider: 'cline-pass',
  },
  {
    id: 'cline-pass/deepseek-v4-pro',
    label: 'DeepSeek V4 Pro',
    description: 'Frontier reasoning · 1M · ClinePass',
    contextWindow: 1_048_576,
    supportsImages: false,
    group: 'ClinePass',
    apiProvider: 'cline-pass',
  },
  {
    id: 'cline-pass/deepseek-v4-flash',
    label: 'DeepSeek V4 Flash',
    description: 'Schnell · 1M · ClinePass',
    contextWindow: 1_048_576,
    supportsImages: false,
    group: 'ClinePass',
    apiProvider: 'cline-pass',
  },
  {
    id: 'cline-pass/mimo-v2.5-pro',
    label: 'MiMo V2.5 Pro',
    description: 'Lange Runs · 1M · ClinePass',
    contextWindow: 1_050_000,
    supportsImages: false,
    group: 'ClinePass',
    apiProvider: 'cline-pass',
  },
  {
    id: 'cline-pass/mimo-v2.5',
    label: 'MiMo V2.5',
    description: 'Alltag · 1M · multimodal · ClinePass',
    contextWindow: 1_050_000,
    supportsImages: true,
    group: 'ClinePass',
    apiProvider: 'cline-pass',
  },
  {
    id: 'cline-pass/minimax-m3',
    label: 'MiniMax M3',
    description: 'Frontier · 1M · multimodal · ClinePass',
    contextWindow: 1_048_576,
    supportsImages: true,
    group: 'ClinePass',
    apiProvider: 'cline-pass',
  },
  {
    id: 'cline-pass/qwen3.8-max',
    label: 'Qwen3.8 Max',
    description: 'SOTA Coding · 1M · multimodal · ClinePass',
    contextWindow: 1_000_000,
    supportsImages: true,
    group: 'ClinePass',
    apiProvider: 'cline-pass',
  },
  {
    id: 'cline-pass/qwen3.7-max',
    label: 'Qwen3.7 Max',
    description: 'Flagship · 1M · ClinePass',
    contextWindow: 1_000_000,
    supportsImages: false,
    group: 'ClinePass',
    apiProvider: 'cline-pass',
  },
  {
    id: 'cline-pass/qwen3.7-plus',
    label: 'Qwen3.7 Plus',
    description: 'Schnell · 1M · multimodal · ClinePass',
    contextWindow: 1_000_000,
    supportsImages: true,
    group: 'ClinePass',
    apiProvider: 'cline-pass',
  },
];

const CLINE_PASS_BY_ID = new Map(CLINE_PASS_MODELS.map((model) => [model.id, model]));

export function isClineThinkingLevel(value: unknown): value is ClineThinkingLevel {
  return typeof value === 'string' && (CLINE_THINKING_LEVELS as readonly string[]).includes(value);
}

export function isClineApiProvider(value: unknown): value is ClineApiProviderId {
  return typeof value === 'string' && CLINE_API_PROVIDERS.some((entry) => entry.id === value);
}

export function isClinePassModel(model: string): boolean {
  return model.startsWith('cline-pass/');
}

export function getClineModelMeta(model: string): ClineModelMeta | null {
  return CLINE_PASS_BY_ID.get(model) ?? null;
}

export function getClineModelContextWindow(model: string): number {
  return getClineModelMeta(model)?.contextWindow ?? DEFAULT_CLINE_CONTEXT_WINDOW;
}

export function resolveClineApiProvider(
  model: string,
  fallback: ClineApiProviderId = 'cline-pass',
): ClineApiProviderId {
  if (model.startsWith('cline-pass/')) {
    return 'cline-pass';
  }
  if (model.startsWith('cline/')) {
    return 'cline';
  }
  return isClineApiProvider(fallback) ? fallback : 'cline-pass';
}

export function formatClineModelLabel(model: string): string {
  const meta = getClineModelMeta(model);
  if (meta) {
    return meta.label;
  }
  const trimmed = model.trim();
  if (!trimmed) {
    return 'Cline';
  }
  const tail = trimmed.includes('/') ? trimmed.slice(trimmed.lastIndexOf('/') + 1) : trimmed;
  return tail
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ') || tail;
}

export function toClineModelOption(meta: ClineModelMeta): ProviderUIOption {
  return {
    value: meta.id,
    label: meta.label,
    description: meta.description,
    group: meta.group,
    providerId: 'cline',
    providerIcon: CLINE_PROVIDER_ICON,
    isDefault: meta.id === DEFAULT_CLINE_PRIMARY_MODEL,
  };
}

export const DEFAULT_CLINE_MODELS: ProviderUIOption[] = CLINE_PASS_MODELS.map(toClineModelOption);

export const DEFAULT_CLINE_MODEL_SET = new Set<string>(CLINE_PASS_MODELS.map((model) => model.id));
