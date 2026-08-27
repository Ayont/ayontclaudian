import type { AuxQueryConfig, AuxQueryRunner } from '../../../core/auxiliary/AuxQueryRunner';
import type ClaudianPlugin from '../../../main';
import { runColdStartQuery } from './claudeColdStartQuery';

/** Isolated, non-persistent Claude runner for verifier and other auxiliary prompts. */
export class ClaudeAuxQueryRunner implements AuxQueryRunner {
  private activeAbortController: AbortController | null = null;

  constructor(private readonly plugin: ClaudianPlugin) {}

  async query(config: AuxQueryConfig, prompt: string): Promise<string> {
    const abortController = config.abortController ?? new AbortController();
    this.activeAbortController = abortController;

    try {
      const result = await runColdStartQuery({
        plugin: this.plugin,
        systemPrompt: config.systemPrompt,
        model: config.model,
        abortController,
        onTextChunk: config.onTextChunk,
        tools: [],
        thinking: { disabled: true },
        persistSession: false,
      }, prompt);
      if (result.usage) config.onUsage?.(result.usage);
      return result.text;
    } finally {
      if (this.activeAbortController === abortController) {
        this.activeAbortController = null;
      }
    }
  }

  reset(): void {
    this.activeAbortController?.abort();
    this.activeAbortController = null;
  }
}
