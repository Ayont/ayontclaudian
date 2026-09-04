import { parseModelEffort } from '../providers/modelOptionGroups';
import type { ProviderUIOption } from '../providers/types';
import {
  inferRouterTask,
  type ModelRouteContext,
  type ModelRouteDecision,
  type ModelRouterTask,
} from './modelRouterRules';

export type AutoComplexity = 'trivial' | 'standard' | 'hard';

const TASK_PATTERNS: Record<ModelRouterTask, RegExp[]> = {
  code: [/kimi.*code/i, /for-coding/i, /cline/i, /codex/i, /grok/i, /sonnet/i, /opus/i, /gpt-[56]/i],
  writing: [/claude/i, /sonnet/i, /gpt/i, /opus/i],
  planning: [/opus/i, /grok-4/i, /kimi.*k3/i, /sonnet/i, /reason/i],
  vision: [/claude/i, /gpt/i, /gemini/i, /kimi/i],
  analysis: [/kimi/i, /gpt/i, /claude/i, /gemini/i],
  document: [/claude/i, /gpt/i, /kimi/i, /gemini/i],
  cheap: [/haiku/i, /flash/i, /mini/i, /highspeed/i, /nano/i, /air/i],
  longcontext: [/claude/i, /gemini/i, /kimi/i],
  default: [/sonnet/i, /grok/i, /gpt-[56]/i, /kimi/i],
};

export function inferAutoComplexity(prompt: string, context?: ModelRouteContext): AutoComplexity {
  const text = prompt.trim();
  if (context?.estimatedTokens && context.estimatedTokens > 20_000) return 'hard';
  if (text.length >= 800) return 'hard';
  if (/architektur|architecture|roadmap|meilenstein|multi-agent|refactor.*system|gesamte/i.test(text)) {
    return 'hard';
  }
  if (text.length <= 40 && /^(ok|ja|nein|danke|thanks|hi|hallo|hello|yes|no)\b/i.test(text)) {
    return 'trivial';
  }
  if (inferRouterTask(text) === 'cheap') return 'trivial';
  return 'standard';
}

function haystack(model: ProviderUIOption): string {
  return `${model.value} ${model.label}`;
}

function taskAffinity(model: ProviderUIOption, task: ModelRouterTask): number {
  const text = haystack(model);
  const patterns = TASK_PATTERNS[task] ?? [];
  let score = 0;
  for (let index = 0; index < patterns.length; index++) {
    if (patterns[index].test(text)) {
      score += Math.max(2, 9 - index);
    }
  }
  return score;
}

function effortBonus(model: ProviderUIOption, complexity: AutoComplexity): number {
  const effort = parseModelEffort(model.value, model.label).level;
  const cheap = /haiku|flash|mini|highspeed|nano|air/i.test(haystack(model));
  const heavy = /opus|k3|grok-4\.6|thinking/i.test(haystack(model));
  if (complexity === 'trivial') {
    if (effort === 'low' || cheap) return 6;
    if (effort === 'high' || effort === 'thinking' || heavy) return -4;
    return 1;
  }
  if (complexity === 'hard') {
    if (effort === 'high' || effort === 'thinking' || heavy) return 6;
    if (effort === 'low' || cheap) return -3;
    return 2;
  }
  if (effort === 'medium') return 3;
  if (effort === 'high') return 2;
  return 0;
}

export function chooseBestAutoModel(options: {
  prompt: string;
  availableModels: ProviderUIOption[];
  unavailableProviderIds?: Iterable<string>;
  providerScores?: Record<string, number>;
  fallbackModel: string;
  context?: ModelRouteContext;
}): ModelRouteDecision {
  const blocked = new Set(options.unavailableProviderIds ?? []);
  const task = inferRouterTask(options.prompt);
  const complexity = inferAutoComplexity(options.prompt, options.context);
  const candidates = options.availableModels.filter((model) => {
    if (model.value === '__auto__') return false;
    if (model.providerId && blocked.has(model.providerId)) return false;
    return true;
  });

  const pool = candidates.length > 0
    ? candidates
    : options.availableModels.filter((model) => model.value !== '__auto__');

  let best = pool[0];
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const model of pool) {
    const capacity = model.providerId ? (options.providerScores?.[model.providerId] ?? 0) : 0;
    const score = taskAffinity(model, task) + effortBonus(model, complexity) + capacity * 2;
    if (score > bestScore) {
      best = model;
      bestScore = score;
    }
  }

  const chosen = best ?? options.availableModels.find((model) => model.value === options.fallbackModel);
  return {
    task,
    model: chosen?.value ?? options.fallbackModel,
    providerId: chosen?.providerId,
    reason: `${complexity} · frei`,
  };
}
