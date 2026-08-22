import type { ProviderUIOption } from '../../core/providers/types';
import {
  DEFAULT_DSH_CONTEXT_WINDOW,
  DEFAULT_DSH_MODELS,
} from './types/models';

/** Context window for a model id — the harness default for everything. */
export function getDshModelContextWindow(_model: string): number {
  return DEFAULT_DSH_CONTEXT_WINDOW;
}

/**
 * Build the model dropdown: the single honest default entry. Extra ids are
 * not offered because the headless profile has no launch-time model surface.
 */
export function getDshModelOptions(_settings: Record<string, unknown>): ProviderUIOption[] {
  return [...DEFAULT_DSH_MODELS];
}

/** Resolve the active model id — always the built-in default today. */
export function resolveDshModelSelection(
  _settings: Record<string, unknown>,
  _currentModel: string,
): string {
  return DEFAULT_DSH_MODELS[0]?.value ?? 'default';
}
