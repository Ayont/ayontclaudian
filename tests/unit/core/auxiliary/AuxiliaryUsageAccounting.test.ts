import {
  buildAuxiliaryUsageReport,
  type CompletedAuxiliaryCall,
  CONSUME_AUXILIARY_CALL,
  withInlineEditUsage,
  withInstructionRefineUsage,
  withTitleGenerationUsage,
} from '@/core/auxiliary/AuxiliaryUsageAccounting';
import type {
  InlineEditService,
  InstructionRefineService,
  TitleGenerationService,
} from '@/core/providers/types';
import type { UsageInfo } from '@/core/types';

const PROVIDER_USAGE: UsageInfo = {
  contextTokens: 41,
  contextWindow: 200_000,
  contextWindowIsAuthoritative: true,
  inputTokens: 41,
  model: 'reported-model',
  outputTokens: 7,
  percentage: 0,
  reportType: 'final',
};

function createOptions() {
  const recordAuxiliaryUsage = jest.fn();
  return {
    options: {
      getDefaultModel: () => 'default-model',
      plugin: { recordAuxiliaryUsage } as any,
      providerId: 'dsh' as const,
    },
    recordAuxiliaryUsage,
  };
}

describe('auxiliary usage accounting', () => {
  it('prefers provider telemetry and normalizes one call to an additive delta', () => {
    const report = buildAuxiliaryUsageReport({
      inputTexts: ['fallback input'],
      model: 'fallback-model',
      outputText: 'fallback output',
      providerId: 'dsh',
      usageReports: [PROVIDER_USAGE],
    });

    expect(report).toEqual(expect.objectContaining({
      contextTokens: 41,
      inputTokens: 41,
      model: 'reported-model',
      outputTokens: 7,
      reportType: 'delta',
    }));
  });

  it('uses the non-authoritative text estimator when a transport has no telemetry', () => {
    const report = buildAuxiliaryUsageReport({
      inputTexts: ['1234'],
      model: 'fallback-model',
      outputText: '12',
      providerId: 'dsh',
    });

    expect(report).toEqual(expect.objectContaining({
      contextTokens: 2,
      contextWindowIsAuthoritative: false,
      model: 'fallback-model',
      reportType: 'delta',
    }));
  });

  it('accounts one successful title call exactly once even if a provider repeats its callback', async () => {
    const completed = new Map<string, CompletedAuxiliaryCall>();
    const service: TitleGenerationService & {
      [CONSUME_AUXILIARY_CALL](operationKey?: string): CompletedAuxiliaryCall | null;
    } = {
      cancel: jest.fn(),
      async generateTitle(conversationId, _userMessage, callback): Promise<void> {
        completed.set(conversationId, {
          outputText: 'Raw title',
          usageReports: [PROVIDER_USAGE],
        });
        await callback(conversationId, { success: true, title: 'Raw title' });
        await callback(conversationId, { success: true, title: 'Repeated callback' });
      },
      [CONSUME_AUXILIARY_CALL](operationKey): CompletedAuxiliaryCall | null {
        if (!operationKey) return null;
        const call = completed.get(operationKey) ?? null;
        completed.delete(operationKey);
        return call;
      },
    };
    const { options, recordAuxiliaryUsage } = createOptions();
    const wrapped = withTitleGenerationUsage(service, options);
    const callback = jest.fn();

    await wrapped.generateTitle('conversation-1', 'Fix the renderer', callback);

    expect(callback).toHaveBeenCalledTimes(2);
    expect(recordAuxiliaryUsage).toHaveBeenCalledTimes(1);
    expect(recordAuxiliaryUsage).toHaveBeenCalledWith(expect.objectContaining({
      model: 'default-model',
      outputText: 'Raw title',
      providerId: 'dsh',
      usageReports: [PROVIDER_USAGE],
    }));
  });

  it('accounts instruction refinement and each continuation as separate calls', async () => {
    const completed: CompletedAuxiliaryCall[] = [
      { outputText: '<instruction>First</instruction>' },
      { outputText: '<instruction>Second</instruction>' },
    ];
    const service: InstructionRefineService & {
      [CONSUME_AUXILIARY_CALL](): CompletedAuxiliaryCall | null;
    } = {
      cancel: jest.fn(),
      continueConversation: jest.fn().mockResolvedValue({
        refinedInstruction: 'Second',
        success: true,
      }),
      refineInstruction: jest.fn().mockResolvedValue({
        refinedInstruction: 'First',
        success: true,
      }),
      resetConversation: jest.fn(),
      setModelOverride: jest.fn(),
      [CONSUME_AUXILIARY_CALL]: () => completed.shift() ?? null,
    };
    const { options, recordAuxiliaryUsage } = createOptions();
    const wrapped = withInstructionRefineUsage(service, options);
    wrapped.setModelOverride?.(' chosen-model ');

    await wrapped.refineInstruction('be concise', 'Existing');
    await wrapped.continueConversation('make it stricter');

    expect(recordAuxiliaryUsage).toHaveBeenCalledTimes(2);
    expect(recordAuxiliaryUsage.mock.calls.map(([record]) => record.model))
      .toEqual(['chosen-model', 'chosen-model']);
    expect(recordAuxiliaryUsage.mock.calls[1][0].inputTexts).toContain('make it stricter');
    expect(service.setModelOverride).toHaveBeenCalledWith(' chosen-model ');
  });

  it('accounts inline edit and each continuation as separate calls', async () => {
    const completed: CompletedAuxiliaryCall[] = [
      { outputText: '<replacement>New</replacement>' },
      { outputText: '<replacement>Newer</replacement>' },
    ];
    const service: InlineEditService & {
      [CONSUME_AUXILIARY_CALL](): CompletedAuxiliaryCall | null;
    } = {
      cancel: jest.fn(),
      continueConversation: jest.fn().mockResolvedValue({ editedText: 'Newer', success: true }),
      editText: jest.fn().mockResolvedValue({ editedText: 'New', success: true }),
      resetConversation: jest.fn(),
      setModelOverride: jest.fn(),
      [CONSUME_AUXILIARY_CALL]: () => completed.shift() ?? null,
    };
    const { options, recordAuxiliaryUsage } = createOptions();
    const wrapped = withInlineEditUsage(service, options);

    await wrapped.editText({
      instruction: 'Improve',
      mode: 'selection',
      notePath: 'note.md',
      selectedText: 'Old',
    });
    await wrapped.continueConversation('Shorter', ['context.md']);

    expect(recordAuxiliaryUsage).toHaveBeenCalledTimes(2);
    expect(recordAuxiliaryUsage.mock.calls[0][0].inputTexts[1]).toContain('<editor_selection');
    expect(recordAuxiliaryUsage.mock.calls[1][0].inputTexts[1]).toContain('<context_files>');
  });

  it('does not invent usage for cancelled or failed calls', async () => {
    const failedRefine: InstructionRefineService = {
      cancel: jest.fn(),
      continueConversation: jest.fn().mockResolvedValue({ error: 'Cancelled', success: false }),
      refineInstruction: jest.fn().mockResolvedValue({ error: 'Provider failed', success: false }),
      resetConversation: jest.fn(),
    };
    const failedInline: InlineEditService = {
      cancel: jest.fn(),
      continueConversation: jest.fn().mockResolvedValue({ error: 'Cancelled', success: false }),
      editText: jest.fn().mockResolvedValue({ error: 'Provider failed', success: false }),
      resetConversation: jest.fn(),
    };
    const failedTitle: TitleGenerationService = {
      cancel: jest.fn(),
      generateTitle: jest.fn(async (conversationId, _message, callback) => {
        await callback(conversationId, { error: 'Cancelled', success: false });
      }),
    };
    const { options, recordAuxiliaryUsage } = createOptions();

    await withInstructionRefineUsage(failedRefine, options)
      .refineInstruction('test', '');
    await withInlineEditUsage(failedInline, options).editText({
      instruction: 'test',
      mode: 'selection',
      notePath: 'note.md',
      selectedText: 'text',
    });
    await withTitleGenerationUsage(failedTitle, options)
      .generateTitle('conversation-1', 'test', jest.fn());
    failedRefine.cancel();
    failedInline.cancel();
    failedTitle.cancel();

    expect(recordAuxiliaryUsage).not.toHaveBeenCalled();
  });
});
