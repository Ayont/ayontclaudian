import type { ProviderId, ProviderUIOption } from '../providers/types';

export type ModelRouterTask = 'code' | 'writing' | 'planning' | 'vision' | 'cheap' | 'default';

export interface ModelRouterRule {
  task: ModelRouterTask;
  model: string;
  providerId?: ProviderId;
  enabled?: boolean;
  keywords?: string[];
}

export interface ModelRouteDecision {
  task: ModelRouterTask;
  model: string;
  providerId?: ProviderId;
  reason: string;
}

const DEFAULT_KEYWORDS: Record<ModelRouterTask, string[]> = {
  code: ['code', 'bug', 'fix', 'refactor', 'typescript', 'javascript', 'python', 'rust', 'test', 'lint', 'build', 'stacktrace', 'diff'],
  writing: ['write', 'rewrite', 'summarize', 'summary', 'blog', 'email', 'copy', 'tone', 'übersetze', 'zusammenfassung', 'schreib'],
  planning: ['plan', 'roadmap', 'strategy', 'brainstorm', 'todo', 'architecture', 'design', 'konzept'],
  vision: ['screenshot', 'image', 'bild', 'ui', 'design review', 'diagram', 'mockup'],
  cheap: ['quick', 'kurz', 'simple', 'yes/no', 'klein', 'schnell'],
  default: [],
};

function normalize(value: string): string {
  return value.toLowerCase();
}

export function inferRouterTask(prompt: string): ModelRouterTask {
  const text = normalize(prompt);
  const ordered: ModelRouterTask[] = ['vision', 'code', 'planning', 'writing', 'cheap'];
  for (const task of ordered) {
    if (DEFAULT_KEYWORDS[task].some(keyword => text.includes(keyword))) {
      return task;
    }
  }
  return 'default';
}

export function normalizeRouterRules(value: unknown): ModelRouterRule[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object' && !Array.isArray(entry))
    .map((entry) => ({
      task: typeof entry.task === 'string' && entry.task in DEFAULT_KEYWORDS
        ? entry.task as ModelRouterTask
        : 'default',
      model: typeof entry.model === 'string' ? entry.model.trim() : '',
      providerId: typeof entry.providerId === 'string' ? entry.providerId as ProviderId : undefined,
      enabled: entry.enabled !== false,
      keywords: Array.isArray(entry.keywords)
        ? entry.keywords.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : undefined,
    }))
    .filter(rule => rule.model.length > 0);
}

export function chooseModelRoute(options: {
  prompt: string;
  rules: ModelRouterRule[];
  availableModels: ProviderUIOption[];
  fallbackModel: string;
}): ModelRouteDecision {
  const availableValues = new Set(options.availableModels.map(model => model.value));
  const normalizedPrompt = normalize(options.prompt);

  for (const rule of options.rules.filter(rule => rule.enabled !== false)) {
    const keywords = rule.keywords ?? DEFAULT_KEYWORDS[rule.task] ?? [];
    if (keywords.length > 0 && keywords.some(keyword => normalizedPrompt.includes(normalize(keyword)))) {
      if (availableValues.has(rule.model)) {
        return { task: rule.task, model: rule.model, providerId: rule.providerId, reason: `keyword matched ${rule.task}` };
      }
    }
  }

  const inferred = inferRouterTask(options.prompt);
  const exactRule = options.rules.find(rule => rule.enabled !== false && rule.task === inferred && availableValues.has(rule.model));
  if (exactRule) {
    return { task: inferred, model: exactRule.model, providerId: exactRule.providerId, reason: `task inferred as ${inferred}` };
  }

  const defaultRule = options.rules.find(rule => rule.enabled !== false && rule.task === 'default' && availableValues.has(rule.model));
  if (defaultRule) {
    return { task: inferred, model: defaultRule.model, providerId: defaultRule.providerId, reason: 'default router rule' };
  }

  return { task: inferred, model: options.fallbackModel, reason: 'no matching router rule' };
}

export function formatRouterRulesExample(): string {
  return [
    '[',
    '  { "task": "code", "model": "kimi-code/kimi-for-coding" },',
    '  { "task": "writing", "model": "gpt-5.1" },',
    '  { "task": "planning", "model": "claude-sonnet-4-5" },',
    '  { "task": "cheap", "model": "haiku" }',
    ']',
  ].join('\n');
}
