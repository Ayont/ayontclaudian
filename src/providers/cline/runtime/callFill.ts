import type { ClineRunUsage } from '../normalization/jsonEvents';

/**
 * The context window fill of a Cline run: the prompt of its latest model call.
 * `usage.updated` reports deltas, so one call's prompt is their sum between
 * two `iteration_start` events; `run_result.usage` adds up every call instead.
 */
export class ClineCallFill {
  private current = 0;
  private latestCall = 0;

  startCall(): void {
    this.current = 0;
  }

  addUsage(usage: Pick<ClineRunUsage, 'inputTokens' | 'cacheReadTokens' | 'cacheWriteTokens'>): void {
    this.current += (usage.inputTokens ?? 0) + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
    this.latestCall = this.current;
  }

  /** 0 when the run reported no per-call usage. */
  latest(): number {
    return this.latestCall;
  }
}
