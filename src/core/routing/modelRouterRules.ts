import type { ProviderId, ProviderUIOption } from '../providers/types';

/** Sentinel value used when the user selects "Auto" in the model dropdown. */
export const AUTO_MODEL_VALUE = '__auto__';

export type ModelRouterTask =
  | 'code'
  | 'writing'
  | 'planning'
  | 'vision'
  | 'analysis'
  | 'document'
  | 'cheap'
  | 'longcontext'
  | 'default';

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
  code: [
    'code', 'bug', 'fix', 'refactor', 'typescript', 'javascript', 'python', 'rust', 'test',
    'lint', 'build', 'stacktrace', 'diff', 'compile', 'error', 'debug', 'function', 'class',
    'api', 'endpoint', 'sql', 'query', 'regex', 'algorithm', 'git', 'merge', 'commit',
    'programm', 'fehler', 'funktion', 'kompilier', 'skript',
  ],
  writing: [
    'write', 'rewrite', 'summarize', 'summary', 'blog', 'email', 'copy', 'tone',
    'übersetze', 'zusammenfassung', 'schreib', 'text', 'artikel', 'brief', 'dokumentation',
    'markdown', 'formatier', 'formulieren', 'verfassen', 'redigieren',
  ],
  planning: [
    'plan', 'roadmap', 'strategy', 'brainstorm', 'todo', 'architecture', 'design', 'konzept',
    'planen', 'strategie', 'entwurf', 'architektur', 'meilenstein', 'projektplan',
    'priorisier', 'aufgaben', 'workflow', 'prozess',
  ],
  vision: [
    'screenshot', 'image', 'bild', 'ui', 'design review', 'diagram', 'mockup',
    'foto', 'grafik', 'visualisierung', 'chart', 'diagramm', 'mock-up', 'wireframe',
    'look at this', 'sieh dir das an', 'bildschirm',
  ],
  analysis: [
    'analyze', 'analysis', 'data', 'excel', 'csv', 'spreadsheet', 'statistics', 'chart',
    'analyse', 'daten', 'tabelle', 'statistik', 'auswertung', 'kennzahlen', 'metriken',
    'trend', 'korrelation', 'regression', 'dashboard', 'report',
  ],
  document: [
    'pdf', 'docx', 'word', 'document', 'read file', 'parse file', 'extract text',
    'dokument', 'datei', 'lesen', 'extrahieren', 'konvertieren', 'ocr',
  ],
  cheap: [
    'quick', 'kurz', 'simple', 'yes/no', 'klein', 'schnell', 'short', 'brief',
    'danke', 'thanks', 'ok', 'ja', 'nein', 'hello', 'hi', 'hallo',
  ],
  longcontext: [
    'long', 'large', 'entire', 'whole', 'all files', 'complete', 'full context',
    'komplett', 'gesamte', 'alle dateien', 'vollständig', 'alles',
  ],
  default: [],
};

function normalize(value: string): string {
  return value.toLowerCase();
}

export function inferRouterTask(prompt: string): ModelRouterTask {
  const text = normalize(prompt);
  // Priority order: vision → document → analysis → code → planning → writing → longcontext → cheap
  const ordered: ModelRouterTask[] = ['vision', 'document', 'analysis', 'code', 'planning', 'writing', 'longcontext', 'cheap'];
  for (const task of ordered) {
    if (DEFAULT_KEYWORDS[task].some(keyword => text.includes(keyword))) {
      return task;
    }
  }
  return 'default';
}

export interface ModelRouteContext {
  /** True when the prompt includes image attachments. */
  hasImages?: boolean;
  /** Estimated token count of the full prompt + context. */
  estimatedTokens?: number;
  /** File extensions attached (e.g. ['pdf', 'xlsx', 'csv']). */
  fileExtensions?: string[];
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
  context?: ModelRouteContext;
}): ModelRouteDecision {
  const availableValues = new Set(options.availableModels.map(model => model.value));
  const normalizedPrompt = normalize(options.prompt);
  const ctx = options.context ?? {};

  // Context-aware overrides: if images are attached, force vision task
  let inferredTask = inferRouterTask(options.prompt);

  // Images attached → always route to vision-capable model
  if (ctx.hasImages && inferredTask !== 'vision') {
    // Try to find a vision-capable model
    const visionRule = options.rules.find(rule =>
      rule.enabled !== false && rule.task === 'vision' && availableValues.has(rule.model));
    if (visionRule) {
      return { task: 'vision', model: visionRule.model, providerId: visionRule.providerId, reason: 'images attached → vision model' };
    }
    // No explicit vision rule — try to find a model with "vision" or "gpt" or "gemini" in its name
    const visionModel = options.availableModels.find(m =>
      /vision|gpt-4|gpt-5|gemini|kimi|claude/i.test(`${m.value} ${m.label}`));
    if (visionModel) {
      return { task: 'vision', model: visionModel.value, reason: 'images attached → vision-capable model' };
    }
  }

  // File extensions → route to document/analysis task
  if (ctx.fileExtensions && ctx.fileExtensions.length > 0) {
    const exts = ctx.fileExtensions.map(e => e.toLowerCase());
    const isData = exts.some(e => ['xlsx', 'xls', 'csv', 'tsv'].includes(e));
    const isDoc = exts.some(e => ['pdf', 'docx', 'doc', 'txt', 'md', 'rtf'].includes(e));
    if (isData && inferredTask !== 'analysis') {
      inferredTask = 'analysis';
    } else if (isDoc && inferredTask !== 'document') {
      inferredTask = 'document';
    }
  }

  // Long context → route to long-context model
  if (ctx.estimatedTokens && ctx.estimatedTokens > 50_000 && inferredTask !== 'longcontext') {
    const longContextModel = options.availableModels.find(m =>
      /claude|gemini|kimi/i.test(`${m.value} ${m.label}`));
    if (longContextModel && availableValues.has(longContextModel.value)) {
      // Only override if the current task's model isn't already a long-context model
      const currentTaskRule = options.rules.find(r => r.enabled !== false && r.task === inferredTask && availableValues.has(r.model));
      if (!currentTaskRule || !/claude|gemini|kimi/i.test(currentTaskRule.model)) {
        return { task: 'longcontext', model: longContextModel.value, reason: `large context (~${ctx.estimatedTokens.toLocaleString()} tokens) → long-context model` };
      }
    }
  }

  // Check explicit rules with keywords first
  for (const rule of options.rules.filter(rule => rule.enabled !== false)) {
    const keywords = rule.keywords ?? DEFAULT_KEYWORDS[rule.task] ?? [];
    if (keywords.length > 0 && keywords.some(keyword => normalizedPrompt.includes(normalize(keyword)))) {
      if (availableValues.has(rule.model)) {
        return { task: rule.task, model: rule.model, providerId: rule.providerId, reason: `keyword matched ${rule.task}` };
      }
    }
  }

  // Match by inferred task
  const exactRule = options.rules.find(rule => rule.enabled !== false && rule.task === inferredTask && availableValues.has(rule.model));
  if (exactRule) {
    return { task: inferredTask, model: exactRule.model, providerId: exactRule.providerId, reason: `task inferred as ${inferredTask}` };
  }

  // Default rule
  const defaultRule = options.rules.find(rule => rule.enabled !== false && rule.task === 'default' && availableValues.has(rule.model));
  if (defaultRule) {
    return { task: inferredTask, model: defaultRule.model, providerId: defaultRule.providerId, reason: 'default router rule' };
  }

  return { task: inferredTask, model: options.fallbackModel, reason: 'no matching router rule' };
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
