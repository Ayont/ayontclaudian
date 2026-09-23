import type { AuxQueryConfig, AuxQueryRunner } from '@/core/auxiliary/AuxQueryRunner';
import {
  CONDENSED_SUMMARY_SYSTEM_PROMPT,
  summarizeConversationForCarry,
} from '@/core/conversation/condensedContextSummary';
import type { ChatMessage, UsageInfo } from '@/core/types';

function messages(): ChatMessage[] {
  return [
    { id: 'u1', role: 'user', content: 'Repariere das Build-Skript', timestamp: 1 },
    { id: 'a1', role: 'assistant', content: 'Erledigt, esbuild lief mit falschem Ziel.', timestamp: 2 },
  ];
}

function runnerReturning(result: Promise<string> | string, usage?: UsageInfo): AuxQueryRunner & {
  calls: Array<{ config: AuxQueryConfig; prompt: string }>;
  reset: jest.Mock;
} {
  const calls: Array<{ config: AuxQueryConfig; prompt: string }> = [];
  return {
    calls,
    reset: jest.fn(),
    async query(config, prompt) {
      calls.push({ config, prompt });
      if (usage) config.onUsage?.(usage);
      return result;
    },
  };
}

describe('summarizeConversationForCarry', () => {
  it('asks the isolated runner for a summary of the visible transcript and goal', async () => {
    const runner = runnerReturning('  Build repariert, Release offen.  ');
    const summary = await summarizeConversationForCarry({
      runner,
      messages: messages(),
      goal: 'Release 2.6',
      maxChars: 500,
      inputMaxChars: 10_000,
      timeoutMs: 1_000,
    });

    expect(summary).toBe('Build repariert, Release offen.');
    expect(runner.calls).toHaveLength(1);
    expect(runner.calls[0].config.systemPrompt).toBe(CONDENSED_SUMMARY_SYSTEM_PROMPT);
    expect(runner.calls[0].prompt).toContain('Repariere das Build-Skript');
    expect(runner.calls[0].prompt).toContain('Release 2.6');
    expect(runner.reset).toHaveBeenCalled();
  });

  it('clips the summary to the requested budget', async () => {
    const runner = runnerReturning('w'.repeat(2_000));
    const summary = await summarizeConversationForCarry({
      runner,
      messages: messages(),
      maxChars: 300,
      inputMaxChars: 10_000,
      timeoutMs: 1_000,
    });
    expect(summary).not.toBeNull();
    expect(summary!.length).toBeLessThanOrEqual(300);
  });

  it('falls back to null when the runner fails or answers empty', async () => {
    const failing: AuxQueryRunner = { reset: jest.fn(), query: jest.fn().mockRejectedValue(new Error('boom')) };
    await expect(summarizeConversationForCarry({
      runner: failing,
      messages: messages(),
      maxChars: 300,
      inputMaxChars: 10_000,
      timeoutMs: 1_000,
    })).resolves.toBeNull();

    await expect(summarizeConversationForCarry({
      runner: runnerReturning('   '),
      messages: messages(),
      maxChars: 300,
      inputMaxChars: 10_000,
      timeoutMs: 1_000,
    })).resolves.toBeNull();
  });

  it('aborts and resets the runner when it exceeds the timeout', async () => {
    jest.useFakeTimers();
    try {
      let seenSignal: AbortSignal | undefined;
      const runner: AuxQueryRunner & { reset: jest.Mock } = {
        reset: jest.fn(),
        query: (config) => {
          seenSignal = config.abortController?.signal;
          return new Promise<string>(() => {});
        },
      };
      const pending = summarizeConversationForCarry({
        runner,
        messages: messages(),
        maxChars: 300,
        inputMaxChars: 10_000,
        timeoutMs: 5_000,
      });
      await jest.advanceTimersByTimeAsync(5_000);
      await expect(pending).resolves.toBeNull();
      expect(seenSignal?.aborted).toBe(true);
      expect(runner.reset).toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('reports what the hidden call consumed so it is booked', async () => {
    const usage: UsageInfo = {
      inputTokens: 120,
      contextTokens: 120,
      contextWindow: 200_000,
      percentage: 0,
      reportType: 'final',
    };
    const onAccounting = jest.fn();
    await summarizeConversationForCarry({
      runner: runnerReturning('kurz', usage),
      messages: messages(),
      maxChars: 300,
      inputMaxChars: 10_000,
      timeoutMs: 1_000,
      onAccounting,
    });
    expect(onAccounting).toHaveBeenCalledTimes(1);
    const record = onAccounting.mock.calls[0][0];
    expect(record.outputText).toBe('kurz');
    expect(record.usageReports).toEqual([usage]);
    expect(record.inputTexts[0]).toBe(CONDENSED_SUMMARY_SYSTEM_PROMPT);
  });

  it('skips the call entirely when there is no renderable transcript', async () => {
    const runner = runnerReturning('nie');
    const summary = await summarizeConversationForCarry({
      runner,
      messages: [],
      maxChars: 300,
      inputMaxChars: 10_000,
      timeoutMs: 1_000,
    });
    expect(summary).toBeNull();
    expect(runner.calls).toHaveLength(0);
  });
});
