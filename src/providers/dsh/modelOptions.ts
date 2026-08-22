import type { ProviderUIOption } from '../../core/providers/types';
import { getDshConfiguredSelectionOptions } from './harnessBridge';
import {
  DEFAULT_DSH_CONTEXT_WINDOW,
  DEFAULT_DSH_MODELS,
} from './types/models';

/** Context window for a model id — the harness default for everything. */
export function getDshModelContextWindow(_model: string): number {
  return DEFAULT_DSH_CONTEXT_WINDOW;
}

/**
 * Build the model dropdown from the models the user configured in the
 * harness's own ~/.dsh/settings.yaml (provider model lists). Falls back to
 * the single honest default entry when nothing is configured or readable.
 */
export function getDshModelOptions(_settings: Record<string, unknown>): ProviderUIOption[] {
  const { options } = getDshConfiguredSelectionOptions();
  if (options.length > 0) {
    return options;
  }
  return [...DEFAULT_DSH_MODELS];
}

/** Resolve the active model id. A pipe selection made in the plugin's own
 *  toolbar wins over the harness file so the chat choice is authoritative;
 *  otherwise the harness's agent-default-model selection is shown. */
export function resolveDshModelSelection(
  _settings: Record<string, unknown>,
  currentModel: string,
): string {
  if (currentModel && currentModel.includes('|')) {
    return currentModel;
  }
  const { active } = getDshConfiguredSelectionOptions();
  if (active) {
    return `${active.provider}|${active.model}`;
  }
  return DEFAULT_DSH_MODELS[0]?.value ?? 'default';
}
