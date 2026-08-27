import type { UsageInfo } from '../types';

export interface AuxQueryConfig {
  systemPrompt: string;
  model?: string;
  abortController?: AbortController;
  onTextChunk?: (accumulatedText: string) => void;
  /** Provider telemetry for this isolated call. Snapshots/finals are normalized centrally. */
  onUsage?: (usage: UsageInfo) => void;
}

export interface AuxQueryRunner {
  query(config: AuxQueryConfig, prompt: string): Promise<string>;
  reset(): void;
}
