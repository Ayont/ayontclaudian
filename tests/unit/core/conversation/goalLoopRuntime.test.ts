import type { AuxQueryConfig } from '@/core/auxiliary/AuxQueryRunner';
import { withGoalLoop } from '@/core/conversation/goalLoopRuntime';
import { parseGoalCommand } from '@/core/conversation/goalPrompt';
import type { ChatRuntime } from '@/core/runtime/ChatRuntime';
import type { PreparedChatTurn } from '@/core/runtime/types';
import type { StreamChunk } from '@/core/types/chat';

const GOAL_PROMPT = '<standing_goal>Test-Ziel</standing_goal>\nMach es.';

function fakeRuntime(handler: (prompt: string) => AsyncGenerator<StreamChunk>): ChatRuntime {
  const runtime = {
    providerId: 'kimi',
    query: (turn: PreparedChatTurn) => handler(turn.prompt),
  };
  return runtime as unknown as ChatRuntime;
}

function requestTextRuntime(
  handler: (prompt: string) => AsyncGenerator<StreamChunk>,
): ChatRuntime {
  const runtime = {
    providerId: 'kimi',
    query: (turn: PreparedChatTurn) => handler(turn.request.text),
  };
  return runtime as unknown as ChatRuntime;
}

function textChunks(chunks: StreamChunk[]): string {
  return chunks.filter((c) => c.type === 'text').map((c) => (c as { content: string }).content).join('');
}

async function drain(gen: AsyncGenerator<StreamChunk>): Promise<StreamChunk[]> {
  const out: StreamChunk[] = [];
  for await (const chunk of gen) out.push(chunk);
  return out;
}

function createVerifierHarness(
  handler: (config: AuxQueryConfig, prompt: string) => Promise<string>,
) {
  const query = jest.fn(handler);
  const reset = jest.fn();
  return {
    createVerifierRunner: () => ({ query, reset }),
    query,
    reset,
  };
}

describe('withGoalLoop', () => {
  it('forwards every optional runtime capability with the base runtime as this', async () => {
    const base = fakeRuntime(async function* () { yield { type: 'done' }; });
    const steer = jest.fn(function (this: ChatRuntime) { return Promise.resolve(this === base); });
    const softSteer = jest.fn(function (this: ChatRuntime) { return Promise.resolve(this === base); });
    const getAuxiliaryModel = jest.fn(function (this: ChatRuntime) { return this === base ? 'aux-model' : null; });
    const loadSubagentToolCalls = jest.fn(function (this: ChatRuntime) {
      if (this !== base) throw new Error('wrong runtime receiver');
      return Promise.resolve([]);
    });
    const loadSubagentFinalResult = jest.fn(function (this: ChatRuntime) { return Promise.resolve(this === base ? 'result' : null); });
    Object.assign(base, { steer, softSteer, getAuxiliaryModel, loadSubagentToolCalls, loadSubagentFinalResult });
    const wrapped = withGoalLoop(base, { isPaused: () => false });
    const turn = { request: { text: 'hi' }, persistedContent: 'hi', prompt: 'hi', isCompact: false, mcpMentions: new Set<string>() };

    await expect(wrapped.steer?.(turn)).resolves.toBe(true);
    await expect(wrapped.softSteer?.(turn)).resolves.toBe(true);
    expect(wrapped.getAuxiliaryModel?.()).toBe('aux-model');
    await expect(wrapped.loadSubagentToolCalls?.('agent-1')).resolves.toEqual([]);
    await expect(wrapped.loadSubagentFinalResult?.('agent-1')).resolves.toBe('result');
    expect(steer).toHaveBeenCalledWith(turn);
    expect(softSteer).toHaveBeenCalledWith(turn);
    expect(loadSubagentToolCalls).toHaveBeenCalledWith('agent-1');
    expect(loadSubagentFinalResult).toHaveBeenCalledWith('agent-1');
  });

  it('passes turns without a framed goal straight through', async () => {
    const seen: string[] = [];
    const base = fakeRuntime(async function* (prompt) {
      seen.push(prompt);
      yield { type: 'text', content: 'plain' };
      yield { type: 'done' };
    });
    const wrapped = withGoalLoop(base, { isPaused: () => false });
    const chunks = await drain(wrapped.query({ request: { text: 'hi' }, persistedContent: '', prompt: 'hi', isCompact: false, mcpMentions: new Set() }));
    expect(seen).toEqual(['hi']);
    expect(textChunks(chunks)).toBe('plain');
  });

  it('verifies the goal and continues until the verifier agrees', async () => {
    const prompts: string[] = [];
    let turn = 0;
    const base = fakeRuntime(async function* (prompt) {
      prompts.push(prompt);
      turn += 1;
      if (turn === 1) {
        yield { type: 'text', content: 'Arbeit 1' };
        yield { type: 'done' };
      } else {
        yield { type: 'text', content: 'Arbeit 2' };
        yield { type: 'done' };
      }
    });
    const verifierPrompts: string[] = [];
    const verdicts = [
      '{"done": false, "reason": "fehlt", "nextStep": "mehr", "confidence": 0.9}',
      '{"done": true, "reason": "ok", "nextStep": "", "confidence": 0.9}',
    ];
    const verifier = createVerifierHarness(async (_config, prompt) => {
      verifierPrompts.push(prompt);
      return verdicts.shift() ?? '';
    });
    const wrapped = withGoalLoop(base, {
      createVerifierRunner: verifier.createVerifierRunner,
      isPaused: () => false,
    });
    const chunks = await drain(wrapped.query({ request: { text: 'goal' }, persistedContent: '', prompt: GOAL_PROMPT, isCompact: false, mcpMentions: new Set() }));
    const text = textChunks(chunks);
    expect(text).toContain('Arbeit 1');
    expect(text).toContain('Arbeit 2');
    expect(text).not.toContain('fehlt');
    expect(prompts).toHaveLength(2);
    expect(prompts.some((p) => p.includes('strenger Prüfer'))).toBe(false);
    expect(verifierPrompts.every((prompt) => prompt.includes('strenger Prüfer'))).toBe(true);
    expect(chunks[chunks.length - 1]?.type).toBe('done');
  });

  it('surfaces every nested work and verifier usage report as an additive delta', async () => {
    const usage = {
      inputTokens: 10,
      outputTokens: 2,
      contextWindow: 1000,
      contextTokens: 12,
      percentage: 1.2,
      reportType: 'final' as const,
    };
    const base = fakeRuntime(async function* () {
      yield { type: 'text', content: 'Arbeit abgeschlossen\nGOAL_ACHIEVED' };
      yield { type: 'usage', usage: { ...usage, inputTokens: 11 } };
      yield { type: 'done' };
    });
    const verifier = createVerifierHarness(async (config) => {
      config.onUsage?.({ ...usage, inputTokens: 12 });
      return '{"done": true, "reason": "ok", "nextStep": "", "confidence": 1}';
    });
    const wrapped = withGoalLoop(base, {
      createVerifierRunner: verifier.createVerifierRunner,
      isPaused: () => false,
    });

    const chunks = await drain(wrapped.query({
      request: { text: GOAL_PROMPT },
      persistedContent: GOAL_PROMPT,
      prompt: GOAL_PROMPT,
      isCompact: false,
      mcpMentions: new Set(),
    }));
    const usageChunks = chunks.filter((chunk) => chunk.type === 'usage');

    expect(usageChunks).toHaveLength(2);
    expect(usageChunks.map((chunk) => chunk.type === 'usage' && chunk.usage.reportType)).toEqual([
      'delta',
      'delta',
    ]);
    expect(usageChunks[1]).toEqual(expect.objectContaining({ contextDisplay: 'preserve' }));
    expect(textChunks(chunks)).toContain('Arbeit abgeschlossen');
    expect(textChunks(chunks)).not.toContain('"done": true');
  });

  it('delivers internal loop prompts through request.text for request-driven providers', async () => {
    const prompts: string[] = [];
    let turn = 0;
    const base = requestTextRuntime(async function* (prompt) {
      prompts.push(prompt);
      turn += 1;
      if (turn === 1) {
        yield { type: 'text', content: 'Arbeit 1' };
      } else {
        yield { type: 'text', content: 'Arbeit 2' };
      }
      yield { type: 'done' };
    });
    const verifierPrompts: string[] = [];
    const verdicts = [
      '{"done": false, "reason": "fehlt", "nextStep": "mehr", "confidence": 0.9}',
      '{"done": true, "reason": "ok", "nextStep": "", "confidence": 0.9}',
    ];
    const verifier = createVerifierHarness(async (_config, prompt) => {
      verifierPrompts.push(prompt);
      return verdicts.shift() ?? '';
    });
    const wrapped = withGoalLoop(base, {
      createVerifierRunner: verifier.createVerifierRunner,
      isPaused: () => false,
    });
    const preparedTurn: PreparedChatTurn = {
      request: { text: GOAL_PROMPT },
      persistedContent: GOAL_PROMPT,
      prompt: GOAL_PROMPT,
      isCompact: false,
      mcpMentions: new Set(),
    };

    const chunks = await drain(wrapped.query(preparedTurn));

    expect(textChunks(chunks)).toContain('Arbeit 2');
    expect(prompts[0]).toContain('<goal_loop>');
    expect(prompts[1]).toContain('Das Ziel ist noch NICHT erreicht');
    expect(verifierPrompts).toHaveLength(2);
  });

  it('forwards conversation history to every work iteration', async () => {
    const seenHistory: unknown[] = [];
    const runtime = {
      providerId: 'dsh',
      query: async function* (turn: PreparedChatTurn, history?: unknown[]) {
        seenHistory.push(history);
        if (turn.request.text.includes('strenger Prüfer')) {
          yield { type: 'text', content: '{"done": true, "reason": "ok", "nextStep": "", "confidence": 1}' } as StreamChunk;
        } else {
          yield { type: 'text', content: 'Arbeit' } as StreamChunk;
        }
        yield { type: 'done' } as StreamChunk;
      },
    } as unknown as ChatRuntime;
    const wrapped = withGoalLoop(runtime, { isPaused: () => false });
    const history = [{ id: 'u1', role: 'user', content: 'Vorher', timestamp: 1 }] as any;
    const turn: PreparedChatTurn = {
      request: { text: GOAL_PROMPT },
      persistedContent: GOAL_PROMPT,
      prompt: GOAL_PROMPT,
      isCompact: false,
      mcpMentions: new Set(),
    };

    await drain(wrapped.query(turn, history));

    expect(seenHistory[0]).toBe(history);
  });

  it('uses the selected query model for the hidden verifier', async () => {
    const visibleModels: Array<string | undefined> = [];
    const runtime = {
      providerId: 'dsh',
      query: async function* (
        _turn: PreparedChatTurn,
        _history?: unknown[],
        options?: { model?: string },
      ) {
        visibleModels.push(options?.model);
        yield { type: 'text', content: 'Arbeit\nGOAL_ACHIEVED' } as StreamChunk;
        yield { type: 'done' } as StreamChunk;
      },
    } as unknown as ChatRuntime;
    const verifierModels: Array<string | undefined> = [];
    const verifier = createVerifierHarness(async (config) => {
      verifierModels.push(config.model);
      return '{"done":true,"reason":"ok","nextStep":"","confidence":1}';
    });
    const wrapped = withGoalLoop(runtime, {
      createVerifierRunner: verifier.createVerifierRunner,
      isPaused: () => false,
    });
    const turn: PreparedChatTurn = {
      request: { text: GOAL_PROMPT },
      persistedContent: GOAL_PROMPT,
      prompt: GOAL_PROMPT,
      isCompact: false,
      mcpMentions: new Set(),
    };

    await drain(wrapped.query(turn, [], { model: 'selected-model' }));

    expect(visibleModels).toEqual(['selected-model']);
    expect(verifierModels).toEqual(['selected-model']);
  });

  it('runs verification in an isolated auxiliary runner, never in the visible provider session', async () => {
    const visiblePrompts: string[] = [];
    const base = fakeRuntime(async function* (prompt) {
      visiblePrompts.push(prompt);
      yield { type: 'text', content: 'Arbeit\nGOAL_ACHIEVED' };
      yield { type: 'done' };
    });
    const reset = jest.fn();
    const query = jest.fn().mockResolvedValue(
      '{"done":true,"reason":"isoliert","nextStep":"","confidence":1}',
    );
    const wrapped = withGoalLoop(base, {
      createVerifierRunner: () => ({ query, reset }),
      isPaused: () => false,
    });
    const turn: PreparedChatTurn = {
      request: { text: GOAL_PROMPT },
      persistedContent: GOAL_PROMPT,
      prompt: GOAL_PROMPT,
      isCompact: false,
      mcpMentions: new Set(),
    };

    await drain(wrapped.query(turn, [], { model: 'selected-model' }));

    expect(visiblePrompts).toHaveLength(1);
    expect(visiblePrompts[0]).not.toContain('strenger Prüfer');
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'selected-model' }),
      expect.stringContaining('strenger Prüfer'),
    );
    expect(reset).toHaveBeenCalled();
  });

  it('keeps hidden verifier metadata off the visible goal turn', async () => {
    let metadata: Record<string, unknown> = {};
    const runtime = {
      providerId: 'claude',
      query: async function* () {
        metadata = { userMessageId: 'work-user', assistantMessageId: 'work-assistant', wasSent: true };
        yield { type: 'text', content: 'Arbeit\nGOAL_ACHIEVED' } as StreamChunk;
        yield { type: 'done' } as StreamChunk;
      },
      consumeTurnMetadata: () => {
        const current = metadata;
        metadata = {};
        return current;
      },
    } as unknown as ChatRuntime;
    const verifier = createVerifierHarness(async () => (
      '{"done":true,"reason":"ok","nextStep":"","confidence":1}'
    ));
    const wrapped = withGoalLoop(runtime, {
      createVerifierRunner: verifier.createVerifierRunner,
      isPaused: () => false,
    });
    const turn: PreparedChatTurn = {
      request: { text: GOAL_PROMPT },
      persistedContent: GOAL_PROMPT,
      prompt: GOAL_PROMPT,
      isCompact: false,
      mcpMentions: new Set(),
    };

    await drain(wrapped.query(turn));

    expect(wrapped.consumeTurnMetadata()).toEqual({
      userMessageId: 'work-user',
      assistantMessageId: 'work-assistant',
      wasSent: true,
    });
  });

  it('aborts a verifier that exceeds its hard deadline', async () => {
    const cancelVisibleTurn = jest.fn();
    const runtime = {
      providerId: 'kimi',
      cancel: cancelVisibleTurn,
      query: async function* () {
        yield { type: 'text', content: 'Arbeit\nGOAL_ACHIEVED' } as StreamChunk;
        yield { type: 'done' } as StreamChunk;
      },
      consumeTurnMetadata: () => ({}),
    } as unknown as ChatRuntime;
    const verifierState: { signal: AbortSignal | null } = { signal: null };
    const verifier = createVerifierHarness((config) => new Promise<string>((_resolve, reject) => {
      verifierState.signal = config.abortController?.signal ?? null;
      config.abortController?.signal.addEventListener('abort', () => reject(new Error('Cancelled')), {
        once: true,
      });
    }));
    const wrapped = withGoalLoop(runtime, {
      createVerifierRunner: verifier.createVerifierRunner,
      isPaused: () => false,
      verificationAbortGraceMs: 10,
      verificationTimeoutMs: 10,
    });
    const turn: PreparedChatTurn = {
      request: { text: GOAL_PROMPT },
      persistedContent: GOAL_PROMPT,
      prompt: GOAL_PROMPT,
      isCompact: false,
      mcpMentions: new Set(),
    };

    const chunks = await drain(wrapped.query(turn));

    expect(cancelVisibleTurn).not.toHaveBeenCalled();
    expect(verifierState.signal?.aborted).toBe(true);
    expect(verifier.reset).toHaveBeenCalled();
    expect(chunks.some((chunk) => (
      chunk.type === 'notice' && chunk.content.includes('Zeitlimit')
    ))).toBe(true);
  });

  it('replays bounded accumulated work for stateless continuation turns', async () => {
    const prompts: string[] = [];
    let workTurn = 0;
    const runtime = fakeRuntime(async function* (prompt) {
      prompts.push(prompt);
      workTurn += 1;
      const content = workTurn === 1
        ? `Ergebnis aus Durchlauf eins: ${'x'.repeat(20_000)}\nGOAL_CONTINUE`
        : 'Weiterarbeit\nGOAL_CONTINUE';
      yield { type: 'text', content };
      yield { type: 'done' };
    });
    const wrapped = withGoalLoop(runtime, {
      isPaused: () => false,
      maxIterations: 2,
      replayAccumulatedWork: true,
    });
    const turn: PreparedChatTurn = {
      request: { text: GOAL_PROMPT },
      persistedContent: GOAL_PROMPT,
      prompt: GOAL_PROMPT,
      isCompact: false,
      mcpMentions: new Set(),
    };

    await drain(wrapped.query(turn));

    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain('<goal_loop_work_so_far>');
    expect(prompts[1]).toContain('Ergebnis aus Durchlauf eins:');
    expect(prompts[1]).toContain('[Frühere Arbeit gekürzt]');
    expect(prompts[1].length).toBeLessThan(15_000);
  });

  it('stops the goal loop when the wrapped runtime is cancelled', async () => {
    const cancel = jest.fn();
    const runtime = {
      providerId: 'kimi',
      cancel,
      query: async function* () {
        yield { type: 'text', content: 'Arbeit\n' } as StreamChunk;
        yield { type: 'done' } as StreamChunk;
      },
    } as unknown as ChatRuntime;
    const wrapped = withGoalLoop(runtime, { isPaused: () => false });
    const turn: PreparedChatTurn = {
      request: { text: GOAL_PROMPT },
      persistedContent: GOAL_PROMPT,
      prompt: GOAL_PROMPT,
      isCompact: false,
      mcpMentions: new Set(),
    };
    const iterator = wrapped.query(turn);

    const first = await iterator.next();
    wrapped.cancel();
    const rest: StreamChunk[] = [];
    for await (const chunk of iterator) rest.push(chunk);

    expect(first.value).toEqual({ type: 'text', content: 'Arbeit\n' });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(rest.some((chunk) => chunk.type === 'notice' && chunk.content.includes('abgebrochen'))).toBe(true);
  });

  it('reports cancellation instead of success when cancelled during verification', async () => {
    let markVerifierStarted: (() => void) | undefined;
    const verifierStarted = new Promise<void>((resolve) => { markVerifierStarted = resolve; });
    const cancelVisibleTurn = jest.fn();
    const runtime = {
      providerId: 'kimi',
      cancel: cancelVisibleTurn,
      query: async function* () {
        yield { type: 'text', content: 'Arbeit abgeschlossen\nGOAL_ACHIEVED' } as StreamChunk;
        yield { type: 'done' } as StreamChunk;
      },
    } as unknown as ChatRuntime;
    const verifier = createVerifierHarness((config) => new Promise<string>((_resolve, reject) => {
      markVerifierStarted?.();
      config.abortController?.signal.addEventListener('abort', () => reject(new Error('Cancelled')), {
        once: true,
      });
    }));
    const wrapped = withGoalLoop(runtime, {
      createVerifierRunner: verifier.createVerifierRunner,
      isPaused: () => false,
    });
    const turn: PreparedChatTurn = {
      request: { text: GOAL_PROMPT },
      persistedContent: GOAL_PROMPT,
      prompt: GOAL_PROMPT,
      isCompact: false,
      mcpMentions: new Set(),
    };

    const result = drain(wrapped.query(turn));
    await verifierStarted;
    wrapped.cancel();
    const chunks = await result;
    const notices = chunks.filter((chunk) => chunk.type === 'notice').map((chunk) => chunk.content);

    expect(notices.some((content) => content.includes('abgebrochen'))).toBe(true);
    expect(notices.some((content) => content.includes('erreicht'))).toBe(false);
    expect(cancelVisibleTurn).toHaveBeenCalledTimes(1);
    expect(verifier.reset).toHaveBeenCalled();
  });

  it('suspends before the next iteration when paused', async () => {
    let turn = 0;
    const base = fakeRuntime(async function* (prompt) {
      turn += 1;
      yield { type: 'text', content: turn === 1 ? 'Arbeit 1' : '{"done": false, "reason": "offen", "nextStep": "", "confidence": 1}' };
      yield { type: 'done' };
    });
    const wrapped = withGoalLoop(base, { isPaused: () => true });
    const chunks = await drain(wrapped.query({ request: { text: 'goal' }, persistedContent: '', prompt: GOAL_PROMPT, isCompact: false, mcpMentions: new Set() }));
    const notices = chunks.filter((c) => c.type === 'notice').map((c) => (c as { content: string }).content).join('');
    expect(notices).toContain('pausiert');
    // Pause hits before the verifier runs — no wasted call while suspended.
    expect(turn).toBe(1);
  });
});

describe('parseGoalCommand', () => {
  it('routes pause, resume and clear keywords', () => {
    expect(parseGoalCommand('pause')).toEqual({ action: 'pause', goal: null });
    expect(parseGoalCommand('resume')).toEqual({ action: 'resume', goal: null });
    expect(parseGoalCommand('done')).toEqual({ action: 'clear', goal: null });
  });

  it('treats anything else as an immediately started goal', () => {
    expect(parseGoalCommand('Refactor die Auth')).toEqual({ action: 'set', goal: 'Refactor die Auth' });
  });
});
