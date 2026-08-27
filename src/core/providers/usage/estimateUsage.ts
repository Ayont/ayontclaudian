import type { UsageInfo } from '../../types';

/**
 * Heuristic context-usage estimation for CLIs that report no token counts
 * (Kimi, Antigravity). Roughly 4 characters per token — the standard rough
 * approximation — so the toolbar can still show a context-window meter. The
 * resulting {@link UsageInfo} is flagged `contextWindowIsAuthoritative: false`
 * because it is an estimate, not provider-reported truth.
 */

const CHARS_PER_TOKEN = 4;

/** Rough token estimate for a string (≈4 chars/token). Empty → 0. */
export function estimateTokens(text: string): number {
  if (!text) {
    return 0;
  }
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** Sum of estimated tokens across many text fragments (ignores empty/nullish). */
export function estimateTokensForTexts(texts: ReadonlyArray<string | null | undefined>): number {
  let total = 0;
  for (const text of texts) {
    if (text) {
      total += estimateTokens(text);
    }
  }
  return total;
}

/**
 * Builds an estimated {@link UsageInfo} from already-counted context tokens and
 * the model's context window. Percentage is clamped to 0–100.
 */
export function buildEstimatedUsageInfo(params: {
  contextTokens: number;
  contextWindow: number;
  model?: string;
  reportType?: UsageInfo['reportType'];
}): UsageInfo {
  const contextTokens = Math.max(0, Math.round(params.contextTokens));
  const contextWindow = params.contextWindow;
  const percentage =
    contextWindow > 0
      ? Math.min(100, Math.max(0, Math.round((contextTokens / contextWindow) * 100)))
      : 0;

  return {
    inputTokens: contextTokens,
    contextTokens,
    contextWindow,
    contextWindowIsAuthoritative: false,
    percentage,
    ...(params.model ? { model: params.model } : {}),
    ...(params.reportType ? { reportType: params.reportType } : {}),
  };
}
