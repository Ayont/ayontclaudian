import {
  type AuxiliaryCallSource,
  type CompletedAuxiliaryCall,
  CONSUME_AUXILIARY_CALL,
} from '../../../core/auxiliary/AuxiliaryUsageAccounting';
import { buildRefineSystemPrompt } from '../../../core/prompt/instructionRefine';
import type { RefineProgressCallback } from '../../../core/providers/types';
import type { InstructionRefineResult } from '../../../core/types';
import type ClaudianPlugin from '../../../main';
import { runColdStartQuery } from '../runtime/claudeColdStartQuery';

export class InstructionRefineService implements AuxiliaryCallSource {
  private plugin: ClaudianPlugin;
  private abortController: AbortController | null = null;
  private completedCall: CompletedAuxiliaryCall | null = null;
  private sessionId: string | null = null;
  private existingInstructions: string = '';

  constructor(plugin: ClaudianPlugin) {
    this.plugin = plugin;
  }

  resetConversation(): void {
    this.sessionId = null;
  }

  async refineInstruction(
    rawInstruction: string,
    existingInstructions: string,
    onProgress?: RefineProgressCallback
  ): Promise<InstructionRefineResult> {
    this.sessionId = null;
    this.existingInstructions = existingInstructions;
    const prompt = `Please refine this instruction: "${rawInstruction}"`;
    return this.sendMessage(prompt, onProgress);
  }

  async continueConversation(
    message: string,
    onProgress?: RefineProgressCallback
  ): Promise<InstructionRefineResult> {
    if (!this.sessionId) {
      return { success: false, error: 'No active conversation to continue' };
    }
    return this.sendMessage(message, onProgress);
  }

  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  [CONSUME_AUXILIARY_CALL](): CompletedAuxiliaryCall | null {
    const completed = this.completedCall;
    this.completedCall = null;
    return completed;
  }

  private async sendMessage(
    prompt: string,
    onProgress?: RefineProgressCallback
  ): Promise<InstructionRefineResult> {
    this.abortController = new AbortController();
    this.completedCall = null;

    try {
      const result = await runColdStartQuery({
        plugin: this.plugin,
        systemPrompt: buildRefineSystemPrompt(this.existingInstructions),
        tools: [],
        resumeSessionId: this.sessionId ?? undefined,
        abortController: this.abortController,
        onTextChunk: onProgress
          ? (accumulatedText: string) => onProgress(this.parseResponse(accumulatedText))
          : undefined,
      }, prompt);

      this.completedCall = {
        outputText: result.text,
        ...(result.usage ? { usageReports: [result.usage] } : {}),
      };

      this.sessionId = result.sessionId;
      return this.parseResponse(result.text);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: msg };
    } finally {
      this.abortController = null;
    }
  }

  private parseResponse(responseText: string): InstructionRefineResult {
    const instructionMatch = responseText.match(/<instruction>([\s\S]*?)<\/instruction>/);
    if (instructionMatch) {
      return { success: true, refinedInstruction: instructionMatch[1].trim() };
    }

    const trimmed = responseText.trim();
    if (trimmed) {
      return { success: true, clarification: trimmed };
    }

    return { success: false, error: 'Empty response' };
  }
}
