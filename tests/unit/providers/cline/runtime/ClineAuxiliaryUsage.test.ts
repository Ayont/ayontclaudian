import type { AuxQueryConfig } from '@/core/auxiliary/AuxQueryRunner';
import type { GoalVerdict } from '@/core/conversation/goalLoop';
import type { UsageInfo } from '@/core/types';
import { ClineAuxQueryRunner } from '@/providers/cline/runtime/ClineAuxQueryRunner';
import { ClineChatRuntime } from '@/providers/cline/runtime/ClineChatRuntime';

interface VerifierRuntime {
  cancel(): void;
  verifyGoalProgress(
    goal: string,
    work: string,
    model?: string,
    signal?: AbortSignal,
  ): Promise<GoalVerdict | null>;
}

const USAGE: UsageInfo = {
  contextTokens: 55,
  contextWindow: 128_000,
  contextWindowIsAuthoritative: true,
  inputTokens: 55,
  model: 'cline-model',
  outputTokens: 8,
  percentage: 0,
  reportType: 'final',
};

describe('Cline goal verifier auxiliary usage', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('accounts the hidden verifier without returning its raw content', async () => {
    const raw = [
      'VERIFIER_ONLY_SENTINEL',
      '{"done":true,"reason":"verified","nextStep":"","confidence":0.9}',
    ].join('\n');
    const query = jest.spyOn(ClineAuxQueryRunner.prototype, 'query')
      .mockImplementation(async (config: AuxQueryConfig) => {
        config.onUsage?.(USAGE);
        return raw;
      });
    const reset = jest.spyOn(ClineAuxQueryRunner.prototype, 'reset').mockImplementation(() => {});
    const recordAuxiliaryUsage = jest.fn();
    const runtime = new ClineChatRuntime({
      recordAuxiliaryUsage,
      settings: {},
    } as any) as unknown as VerifierRuntime;

    const verdict = await runtime.verifyGoalProgress('Ship it', 'Tests pass', 'cline-model');

    expect(verdict).toEqual({
      confidence: 0.9,
      done: true,
      nextStep: '',
      reason: 'verified',
    });
    expect(JSON.stringify(verdict)).not.toContain('VERIFIER_ONLY_SENTINEL');
    expect(recordAuxiliaryUsage).toHaveBeenCalledTimes(1);
    expect(recordAuxiliaryUsage).toHaveBeenCalledWith(expect.objectContaining({
      model: 'cline-model',
      outputText: raw,
      providerId: 'cline',
      usageReports: [USAGE],
    }));
    expect(query).toHaveBeenCalledTimes(1);
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('does not record a failed verifier transport', async () => {
    jest.spyOn(ClineAuxQueryRunner.prototype, 'query')
      .mockRejectedValue(new Error('Cancelled'));
    jest.spyOn(ClineAuxQueryRunner.prototype, 'reset').mockImplementation(() => {});
    const recordAuxiliaryUsage = jest.fn();
    const runtime = new ClineChatRuntime({
      recordAuxiliaryUsage,
      settings: {},
    } as any) as unknown as VerifierRuntime;

    await expect(runtime.verifyGoalProgress('Ship it', 'Work', 'cline-model'))
      .resolves.toBeNull();
    expect(recordAuxiliaryUsage).not.toHaveBeenCalled();
  });

  it('aborts and resets the isolated verifier immediately when the user cancels', async () => {
    const verifierState: { signal: AbortSignal | null } = { signal: null };
    let markStarted: (() => void) | null = null;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    jest.spyOn(ClineAuxQueryRunner.prototype, 'query')
      .mockImplementation((config: AuxQueryConfig) => new Promise<string>((_resolve, reject) => {
        verifierState.signal = config.abortController?.signal ?? null;
        markStarted?.();
        config.abortController?.signal.addEventListener(
          'abort',
          () => reject(new Error('Cancelled')),
          { once: true },
        );
      }));
    const reset = jest.spyOn(ClineAuxQueryRunner.prototype, 'reset').mockImplementation(() => {});
    const runtime = new ClineChatRuntime({
      recordAuxiliaryUsage: jest.fn(),
      settings: {},
    } as any) as unknown as VerifierRuntime;

    const verification = runtime.verifyGoalProgress('Ship it', 'Work', 'cline-model');
    await started;
    runtime.cancel();

    await expect(verification).resolves.toBeNull();
    expect(verifierState.signal?.aborted).toBe(true);
    expect(reset).toHaveBeenCalled();
  });
});
