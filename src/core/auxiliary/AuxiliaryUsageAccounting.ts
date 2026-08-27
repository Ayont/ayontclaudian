import type ClaudianPlugin from '../../main';
import { appendContextFiles } from '../../utils/context';
import {
  buildInlineEditPrompt,
  getInlineEditSystemPrompt,
} from '../prompt/inlineEdit';
import { buildRefineSystemPrompt } from '../prompt/instructionRefine';
import {
  buildTitleGenerationPrompt,
  TITLE_GENERATION_SYSTEM_PROMPT,
} from '../prompt/titleGeneration';
import type {
  InlineEditRequest,
  InlineEditResult,
  InlineEditService,
  InstructionRefineService,
  ProviderId,
  TitleGenerationResult,
  TitleGenerationService,
} from '../providers/types';
import { buildEstimatedUsageInfo, estimateTokensForTexts } from '../providers/usage/estimateUsage';
import { TurnUsageCollector } from '../providers/usage/TurnUsageCollector';
import type { InstructionRefineResult, UsageInfo } from '../types';

/**
 * Internal hand-off from a concrete auxiliary transport to the provider-neutral
 * accounting wrapper. Keeping this behind a symbol avoids expanding the public
 * title/refine/inline service contracts with transport details.
 */
export const CONSUME_AUXILIARY_CALL = Symbol('consumeAuxiliaryCall');

export interface CompletedAuxiliaryCall {
  outputText: string;
  usageReports?: UsageInfo[];
}

export interface AuxiliaryCallSource {
  [CONSUME_AUXILIARY_CALL](operationKey?: string): CompletedAuxiliaryCall | null;
}

export interface AuxiliaryUsageRecord {
  inputTexts: ReadonlyArray<string | null | undefined>;
  model?: string;
  outputText: string;
  providerId: ProviderId;
  usageReports?: UsageInfo[];
}

interface AuxiliaryUsagePlugin {
  recordAuxiliaryUsage?(record: AuxiliaryUsageRecord): void;
}

interface AuxiliaryWrapperOptions {
  getDefaultModel: () => string | undefined;
  plugin: ClaudianPlugin;
  providerId: ProviderId;
}

/**
 * Convert one completed hidden model call into one additive accounting report.
 * Provider reports win. When a transport exposes no usage, the fallback is the
 * same explicitly non-authoritative four-characters-per-token estimate used by
 * chat runtimes without token telemetry.
 */
export function buildAuxiliaryUsageReport(record: AuxiliaryUsageRecord): UsageInfo | null {
  const providerUsage = collectReportedUsage(record.usageReports ?? []);
  if (providerUsage) {
    return {
      ...providerUsage,
      model: providerUsage.model ?? record.model,
      reportType: 'delta',
    };
  }

  const contextTokens = estimateTokensForTexts([
    ...record.inputTexts,
    record.outputText,
  ]);
  if (contextTokens <= 0) {
    return null;
  }

  return buildEstimatedUsageInfo({
    contextTokens,
    contextWindow: 0,
    model: record.model,
    reportType: 'delta',
  });
}

export function withTitleGenerationUsage(
  service: TitleGenerationService,
  options: AuxiliaryWrapperOptions,
): TitleGenerationService {
  return {
    cancel: () => service.cancel(),
    async generateTitle(conversationId, userMessage, callback): Promise<void> {
      let accounted = false;
      await service.generateTitle(conversationId, userMessage, async (resultConversationId, result) => {
        if (!accounted) {
          const completed = consumeCompletedCall(service, conversationId);
          if (completed || result.success) {
            accounted = true;
            recordUsage(options, {
              inputTexts: [
                TITLE_GENERATION_SYSTEM_PROMPT,
                buildTitleGenerationPrompt(userMessage),
              ],
              outputText: completed?.outputText ?? outputFromTitleResult(result),
              usageReports: completed?.usageReports,
            });
          }
        }
        await callback(resultConversationId, result);
      });
    },
  };
}

export function withInstructionRefineUsage(
  service: InstructionRefineService,
  options: AuxiliaryWrapperOptions,
): InstructionRefineService {
  let existingInstructions = '';
  let modelOverride: string | undefined;

  const account = (
    prompt: string,
    result: InstructionRefineResult,
  ): void => {
    const completed = consumeCompletedCall(service);
    if (!completed && !result.success) {
      return;
    }
    recordUsage(options, {
      inputTexts: [buildRefineSystemPrompt(existingInstructions), prompt],
      model: modelOverride,
      outputText: completed?.outputText ?? outputFromRefineResult(result),
      usageReports: completed?.usageReports,
    });
  };

  return {
    cancel: () => service.cancel(),
    async continueConversation(message, onProgress): Promise<InstructionRefineResult> {
      const result = await service.continueConversation(message, onProgress);
      account(message, result);
      return result;
    },
    async refineInstruction(rawInstruction, nextExistingInstructions, onProgress): Promise<InstructionRefineResult> {
      existingInstructions = nextExistingInstructions;
      const prompt = `Please refine this instruction: "${rawInstruction}"`;
      const result = await service.refineInstruction(rawInstruction, nextExistingInstructions, onProgress);
      account(prompt, result);
      return result;
    },
    resetConversation: () => service.resetConversation(),
    setModelOverride(model): void {
      const trimmed = model?.trim();
      modelOverride = trimmed || undefined;
      service.setModelOverride?.(model);
    },
  };
}

export function withInlineEditUsage(
  service: InlineEditService,
  options: AuxiliaryWrapperOptions,
): InlineEditService {
  let modelOverride: string | undefined;

  const account = (prompt: string, result: InlineEditResult): void => {
    const completed = consumeCompletedCall(service);
    if (!completed && !result.success) {
      return;
    }
    recordUsage(options, {
      inputTexts: [getInlineEditSystemPrompt(), prompt],
      model: modelOverride,
      outputText: completed?.outputText ?? outputFromInlineResult(result),
      usageReports: completed?.usageReports,
    });
  };

  return {
    cancel: () => service.cancel(),
    async continueConversation(message, contextFiles): Promise<InlineEditResult> {
      const prompt = contextFiles?.length
        ? appendContextFiles(message, contextFiles)
        : message;
      const result = await service.continueConversation(message, contextFiles);
      account(prompt, result);
      return result;
    },
    async editText(request: InlineEditRequest): Promise<InlineEditResult> {
      const prompt = buildInlineEditPrompt(request);
      const result = await service.editText(request);
      account(prompt, result);
      return result;
    },
    resetConversation: () => service.resetConversation(),
    setModelOverride(model): void {
      const trimmed = model?.trim();
      modelOverride = trimmed || undefined;
      service.setModelOverride?.(model);
    },
  };
}

function consumeCompletedCall(
  service: object,
  operationKey?: string,
): CompletedAuxiliaryCall | null {
  const source = service as Partial<AuxiliaryCallSource>;
  const consume = source[CONSUME_AUXILIARY_CALL];
  return typeof consume === 'function'
    ? consume.call(service, operationKey)
    : null;
}

function recordUsage(
  options: AuxiliaryWrapperOptions,
  call: Omit<AuxiliaryUsageRecord, 'providerId'>,
): void {
  const plugin = options.plugin as unknown as AuxiliaryUsagePlugin;
  plugin.recordAuxiliaryUsage?.({
    ...call,
    model: call.model ?? options.getDefaultModel(),
    providerId: options.providerId,
  });
}

function collectReportedUsage(reports: UsageInfo[]): UsageInfo | null {
  if (reports.length === 0) {
    return null;
  }
  const collector = new TurnUsageCollector();
  for (const report of reports) {
    collector.observe(report);
  }
  const accountingReports = collector.accountingReports();
  if (accountingReports.length === 0) {
    return null;
  }
  if (accountingReports.length === 1) {
    return accountingReports[0];
  }

  const first = accountingReports[0];
  return accountingReports.slice(1).reduce<UsageInfo>((total, report) => ({
    ...total,
    cacheCreationInputTokens: (total.cacheCreationInputTokens ?? 0)
      + (report.cacheCreationInputTokens ?? 0),
    cacheReadInputTokens: (total.cacheReadInputTokens ?? 0)
      + (report.cacheReadInputTokens ?? 0),
    contextTokens: total.contextTokens + report.contextTokens,
    inputTokens: total.inputTokens + report.inputTokens,
    outputTokens: (total.outputTokens ?? 0) + (report.outputTokens ?? 0),
  }), { ...first });
}

function outputFromTitleResult(result: TitleGenerationResult): string {
  return result.success ? result.title : '';
}

function outputFromRefineResult(result: InstructionRefineResult): string {
  if (result.refinedInstruction !== undefined) {
    return `<instruction>${result.refinedInstruction}</instruction>`;
  }
  return result.clarification ?? '';
}

function outputFromInlineResult(result: InlineEditResult): string {
  if (result.editedText !== undefined) {
    return `<replacement>${result.editedText}</replacement>`;
  }
  if (result.insertedText !== undefined) {
    return `<insertion>${result.insertedText}</insertion>`;
  }
  return result.clarification ?? '';
}
