import { readFileSync, statSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

/** The windows the Codex backend declares for one model. */
export interface CodexCatalogWindow {
  contextWindow: number;
  /** The most Codex grants when a larger `model_context_window` is requested. */
  maxContextWindow: number;
  /** Share of the window a turn may use. */
  effectivePercent: number;
}

const CATALOG_FILE = 'models_cache.json';
/** The file changes a few times a day; a minute keeps UI reads cheap. */
const CACHE_TTL_MS = 60_000;

let cache: { file: string; checkedAt: number; mtimeMs: number; windows: Map<string, CodexCatalogWindow> } | null = null;

function positiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

export function parseCodexCatalogWindows(catalog: unknown): Map<string, CodexCatalogWindow> {
  const windows = new Map<string, CodexCatalogWindow>();
  const models = (catalog as { models?: unknown } | null)?.models;
  if (!Array.isArray(models)) return windows;
  for (const entry of models) {
    const model = entry as Record<string, unknown>;
    const slug = typeof model?.slug === 'string' ? model.slug : null;
    const contextWindow = positiveNumber(model?.context_window);
    if (!slug || !contextWindow) continue;
    windows.set(slug, {
      contextWindow,
      maxContextWindow: positiveNumber(model.max_context_window) ?? contextWindow,
      effectivePercent: positiveNumber(model.effective_context_window_percent) ?? 95,
    });
  }
  return windows;
}

/**
 * Reads the model catalog Codex caches from its backend. It is what the
 * server declares for this account, so it tracks raised limits without an
 * update. Null when the file is missing or unreadable.
 */
export function readCodexCatalogWindow(model: string, codexHome = join(homedir(), '.codex')): CodexCatalogWindow | null {
  const file = join(codexHome, CATALOG_FILE);
  const now = Date.now();
  try {
    if (!cache || cache.file !== file || now - cache.checkedAt > CACHE_TTL_MS) {
      const { mtimeMs } = statSync(file);
      if (!cache || cache.file !== file || cache.mtimeMs !== mtimeMs) {
        cache = { file, checkedAt: now, mtimeMs, windows: parseCodexCatalogWindows(JSON.parse(readFileSync(file, 'utf8'))) };
      } else {
        cache.checkedAt = now;
      }
    }
  } catch {
    cache = null;
    return null;
  }
  return cache.windows.get(model) ?? null;
}

export function resetCodexCatalogCache(): void {
  cache = null;
}
