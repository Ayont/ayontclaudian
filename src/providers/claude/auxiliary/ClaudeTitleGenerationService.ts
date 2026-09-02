import {
  type AuxiliaryCallSource,
  type CompletedAuxiliaryCall,
  CONSUME_AUXILIARY_CALL,
} from '../../../core/auxiliary/AuxiliaryUsageAccounting';
import { TITLE_GENERATION_SYSTEM_PROMPT } from '../../../core/prompt/titleGeneration';
import type {
  TitleGenerationCallback,
  TitleGenerationResult,
} from '../../../core/providers/types';
import type ClaudianPlugin from '../../../main';
import { parseEnvironmentVariables } from '../../../utils/env';
import { runColdStartQuery } from '../runtime/claudeColdStartQuery';
import { migrateLegacyClaudeModelAlias } from '../types/models';
import { claudeChatUIConfig } from '../ui/ClaudeChatUIConfig';

export type { TitleGenerationResult };

export class TitleGenerationService implements AuxiliaryCallSource {
  private plugin: ClaudianPlugin;
  private activeGenerations: Map<string, AbortController> = new Map();
  private completedCalls = new Map<string, CompletedAuxiliaryCall>();

  constructor(plugin: ClaudianPlugin) {
    this.plugin = plugin;
  }

  async generateTitle(
    conversationId: string,
    userMessage: string,
    callback: TitleGenerationCallback
  ): Promise<void> {
    this.completedCalls.delete(conversationId);
    // Cancel any existing generation for this conversation
    const existingController = this.activeGenerations.get(conversationId);
    if (existingController) {
      existingController.abort();
    }

    const abortController = new AbortController();
    this.activeGenerations.set(conversationId, abortController);

    const truncatedUser = this.truncateText(userMessage, 500);
    const prompt = `User's request:\n"""\n${truncatedUser}\n"""\n\nGenerate a title for this conversation:`;

    try {
      const result = await runColdStartQuery({
        plugin: this.plugin,
        systemPrompt: TITLE_GENERATION_SYSTEM_PROMPT,
        tools: [],
        model: this.resolveTitleModel(),
        thinking: { disabled: true },
        persistSession: false,
        abortController,
      }, prompt);
      this.completedCalls.set(conversationId, {
        outputText: result.text,
        ...(result.usage ? { usageReports: [result.usage] } : {}),
      });

      const title = this.parseTitle(result.text);
      if (title) {
        await this.safeCallback(callback, conversationId, { success: true, title });
      } else {
        await this.safeCallback(callback, conversationId, {
          success: false,
          error: 'Failed to parse title from response',
        });
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      await this.safeCallback(callback, conversationId, { success: false, error: msg });
    } finally {
      this.activeGenerations.delete(conversationId);
    }
  }

  cancel(): void {
    for (const controller of this.activeGenerations.values()) {
      controller.abort();
    }
    this.activeGenerations.clear();
  }

  [CONSUME_AUXILIARY_CALL](operationKey?: string): CompletedAuxiliaryCall | null {
    if (!operationKey) return null;
    const completed = this.completedCalls.get(operationKey) ?? null;
    this.completedCalls.delete(operationKey);
    return completed;
  }

  private resolveTitleModel(): string {
    const envVars = parseEnvironmentVariables(
      this.plugin.getActiveEnvironmentVariables('claude')
    );
    const settingsBag = this.plugin.settings as unknown as Record<string, unknown>;
    const configured = this.plugin.settings.titleGenerationModel;
    // Persisted floating aliases (`opus`, `sonnet`) from older builds map onto the
    // pinned catalog id; otherwise a saved title model silently degrades to Haiku.
    const titleModel = configured ? migrateLegacyClaudeModelAlias(configured) : configured;
    if (titleModel && claudeChatUIConfig.ownsModel(titleModel, settingsBag)) {
      return titleModel;
    }

    return (
      envVars.ANTHROPIC_DEFAULT_HAIKU_MODEL ||
      'claude-haiku-4-5'
    );
  }

  private truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  }

  private parseTitle(responseText: string): string | null {
    const trimmed = responseText.trim();
    if (!trimmed) return null;

    let title = trimmed;
    if (
      (title.startsWith('"') && title.endsWith('"')) ||
      (title.startsWith("'") && title.endsWith("'"))
    ) {
      title = title.slice(1, -1);
    }

    title = title.replace(/[.!?:;,]+$/, '');

    if (title.length > 50) {
      title = title.substring(0, 47) + '...';
    }

    return title || null;
  }

  private async safeCallback(
    callback: TitleGenerationCallback,
    conversationId: string,
    result: TitleGenerationResult
  ): Promise<void> {
    try {
      await callback(conversationId, result);
    } catch {
      // Silently ignore callback errors
    }
  }
}
