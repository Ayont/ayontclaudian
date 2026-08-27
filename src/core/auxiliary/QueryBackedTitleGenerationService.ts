import {
  buildTitleGenerationPrompt,
  parseTitleGenerationResponse,
  TITLE_GENERATION_SYSTEM_PROMPT,
} from '../prompt/titleGeneration';
import type {
  TitleGenerationCallback,
  TitleGenerationResult,
  TitleGenerationService,
} from '../providers/types';
import type { UsageInfo } from '../types';
import {
  type AuxiliaryCallSource,
  type CompletedAuxiliaryCall,
  CONSUME_AUXILIARY_CALL,
} from './AuxiliaryUsageAccounting';
import type { AuxQueryRunner } from './AuxQueryRunner';

interface ActiveGeneration {
  abortController: AbortController;
  runner: AuxQueryRunner;
}

export interface QueryBackedTitleGenerationServiceOptions {
  createRunner: () => AuxQueryRunner;
  resolveModel?: () => string | undefined;
}

export class QueryBackedTitleGenerationService implements TitleGenerationService, AuxiliaryCallSource {
  private readonly activeGenerations = new Map<string, ActiveGeneration>();
  private readonly completedCalls = new Map<string, CompletedAuxiliaryCall>();

  constructor(private readonly options: QueryBackedTitleGenerationServiceOptions) {}

  async generateTitle(
    conversationId: string,
    userMessage: string,
    callback: TitleGenerationCallback,
  ): Promise<void> {
    this.completedCalls.delete(conversationId);
    const existing = this.activeGenerations.get(conversationId);
    if (existing) {
      existing.abortController.abort();
      existing.runner.reset();
    }

    const abortController = new AbortController();
    const runner = this.options.createRunner();
    const generation = { abortController, runner };
    this.activeGenerations.set(conversationId, generation);
    const usageReports: UsageInfo[] = [];

    try {
      const text = await runner.query({
        abortController,
        model: this.options.resolveModel?.(),
        onUsage: (usage) => usageReports.push(usage),
        systemPrompt: TITLE_GENERATION_SYSTEM_PROMPT,
      }, buildTitleGenerationPrompt(userMessage));
      this.completedCalls.set(conversationId, {
        outputText: text,
        ...(usageReports.length > 0 ? { usageReports } : {}),
      });
      const title = parseTitleGenerationResponse(text);
      await this.safeCallback(
        callback,
        conversationId,
        title
          ? { success: true, title }
          : { success: false, error: 'Failed to parse title from response' },
      );
    } catch (error) {
      await this.safeCallback(callback, conversationId, {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      runner.reset();
      if (this.activeGenerations.get(conversationId) === generation) {
        this.activeGenerations.delete(conversationId);
      }
    }
  }

  cancel(): void {
    for (const active of this.activeGenerations.values()) {
      active.abortController.abort();
      active.runner.reset();
    }
    this.activeGenerations.clear();
  }

  [CONSUME_AUXILIARY_CALL](operationKey?: string): CompletedAuxiliaryCall | null {
    if (!operationKey) {
      return null;
    }
    const completed = this.completedCalls.get(operationKey) ?? null;
    this.completedCalls.delete(operationKey);
    return completed;
  }

  private async safeCallback(
    callback: TitleGenerationCallback,
    conversationId: string,
    result: TitleGenerationResult,
  ): Promise<void> {
    try {
      await callback(conversationId, result);
    } catch {
      // Ignore callback failures to match existing service behavior.
    }
  }
}
