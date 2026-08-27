import { GOAL_CONTINUE_MARKER, GOAL_DONE_MARKER, type GoalVerdict } from '../../../../../src/core/conversation/goalLoop';
import type { StreamChunk } from '../../../../../src/core/types';
import { type ClineGoalLoopDeps, runClineGoalLoop } from '../../../../../src/providers/cline/runtime/ClineGoalLoop';

interface HarnessOptions {
  /** One entry per iteration: the assistant text that turn produces. */
  turns: string[];
  verify?: ((goal: string, work: string) => Promise<GoalVerdict | null>) | null;
  maxIterations?: number;
  cancelAfterTurn?: number;
  errorOnTurn?: number;
  initialPrompt?: string;
}

interface HarnessResult {
  chunks: StreamChunk[];
  prompts: string[];
  echoes: boolean[];
  iterations: number;
  reason: string;
}

async function runHarness(options: HarnessOptions): Promise<HarnessResult> {
  const prompts: string[] = [];
  const echoes: boolean[] = [];
  const chunks: StreamChunk[] = [];
  let cancelled = false;
  let turnIndex = 0;

  const deps: ClineGoalLoopDeps = {
    runTurn: async function* (prompt, turnOptions) {
      prompts.push(prompt);
      echoes.push(turnOptions.echoUserMessage);
      const index = turnIndex;
      turnIndex += 1;

      if (turnOptions.echoUserMessage) {
        yield { type: 'user_message_start', content: prompt };
      }
      if (options.errorOnTurn === index + 1) {
        yield { type: 'error', content: 'kaputt' };
      } else {
        yield { type: 'text', content: options.turns[index] ?? '' };
      }
      if (options.cancelAfterTurn === index + 1) {
        cancelled = true;
      }
      yield { type: 'done' };
    },
    verify: options.verify ?? null,
    isCancelled: () => cancelled,
    maxIterations: options.maxIterations ?? 5,
  };

  const generator = runClineGoalLoop({
    goal: 'Ziel X',
    initialPrompt: options.initialPrompt ?? 'Mach das.',
    deps,
  });
  let next = await generator.next();
  while (!next.done) {
    chunks.push(next.value);
    next = await generator.next();
  }

  return { chunks, prompts, echoes, iterations: next.value.iterations, reason: next.value.reason };
}

describe('runClineGoalLoop', () => {
  test('does not start the first provider turn when cancellation arrived after the opening notice', async () => {
    const runTurn = jest.fn(async function* () {
      yield { type: 'done' } as StreamChunk;
    });
    const generator = runClineGoalLoop({
      goal: 'Ziel X',
      initialPrompt: 'Mach das.',
      deps: {
        isCancelled: () => true,
        maxIterations: 3,
        runTurn,
        verify: null,
      },
    });

    for await (const chunk of generator) {
      // Drain the closing notice and done marker.
      void chunk;
    }

    expect(runTurn).not.toHaveBeenCalled();
  });

  test('stops after one iteration when the agent reports the goal achieved', async () => {
    const result = await runHarness({ turns: [`Erledigt.\n${GOAL_DONE_MARKER}`] });

    expect(result.iterations).toBe(1);
    expect(result.reason).toBe('achieved');
    expect(result.prompts).toHaveLength(1);
  });

  test('keeps looping while the agent reports open work', async () => {
    const result = await runHarness({
      turns: [
        `Schritt 1\n${GOAL_CONTINUE_MARKER}`,
        `Schritt 2\n${GOAL_CONTINUE_MARKER}`,
        `Schritt 3 fertig\n${GOAL_DONE_MARKER}`,
      ],
    });

    expect(result.iterations).toBe(3);
    expect(result.reason).toBe('achieved');
  });

  test('echoes the user message only on the first iteration', async () => {
    const result = await runHarness({
      turns: [`a\n${GOAL_CONTINUE_MARKER}`, `b\n${GOAL_DONE_MARKER}`],
    });

    expect(result.echoes).toEqual([true, false]);
    expect(result.chunks.filter((chunk) => chunk.type === 'user_message_start')).toHaveLength(1);
  });

  test('emits exactly one terminal done chunk for the whole loop', async () => {
    const result = await runHarness({
      turns: [`a\n${GOAL_CONTINUE_MARKER}`, `b\n${GOAL_DONE_MARKER}`],
    });

    expect(result.chunks.filter((chunk) => chunk.type === 'done')).toHaveLength(1);
    expect(result.chunks[result.chunks.length - 1]).toEqual({ type: 'done' });
  });

  test('a verifier can veto the agent claiming completion', async () => {
    const verdicts: GoalVerdict[] = [
      { done: false, reason: 'Tests fehlen', nextStep: 'Tests schreiben', confidence: 0.8 },
      { done: true, reason: 'jetzt vollständig', nextStep: '', confidence: 0.9 },
    ];
    let call = 0;
    const result = await runHarness({
      turns: [`fertig?\n${GOAL_DONE_MARKER}`, `wirklich fertig\n${GOAL_DONE_MARKER}`],
      verify: async () => verdicts[call++] ?? null,
    });

    expect(result.iterations).toBe(2);
    expect(result.reason).toBe('achieved');
    expect(result.prompts[1]).toContain('Tests schreiben');
  });

  test('trusts the continue marker without spending a verifier call', async () => {
    const verify = jest.fn(async () => ({ done: true, reason: '', nextStep: '', confidence: 1 }));
    await runHarness({
      turns: [`weiter\n${GOAL_CONTINUE_MARKER}`, `fertig\n${GOAL_DONE_MARKER}`],
      verify,
    });

    expect(verify).toHaveBeenCalledTimes(1);
  });

  test('falls back to the marker when the verifier yields nothing usable', async () => {
    const result = await runHarness({
      turns: [`fertig\n${GOAL_DONE_MARKER}`],
      verify: async () => null,
    });

    expect(result.reason).toBe('achieved');
  });

  test('stops at the iteration cap and says so', async () => {
    const result = await runHarness({
      turns: ['a', 'b', 'c', 'd'],
      maxIterations: 3,
    });

    expect(result.iterations).toBe(3);
    expect(result.reason).toBe('max-iterations');
  });

  test('stops when two iterations produce identical output', async () => {
    const result = await runHarness({ turns: ['gleiche Antwort', 'gleiche Antwort', 'x'] });

    expect(result.reason).toBe('stalled');
    expect(result.iterations).toBe(2);
  });

  test('stops on cancellation without running another iteration', async () => {
    const result = await runHarness({ turns: ['a', 'b', 'c'], cancelAfterTurn: 1 });

    expect(result.reason).toBe('cancelled');
    expect(result.prompts).toHaveLength(1);
  });

  test('stops when a turn streams an error', async () => {
    const result = await runHarness({ turns: ['a', 'b'], errorOnTurn: 1 });

    expect(result.reason).toBe('error');
    expect(result.prompts).toHaveLength(1);
  });

  test('appends the loop directive to every iteration prompt', async () => {
    const result = await runHarness({ turns: ['a', `b\n${GOAL_DONE_MARKER}`] });

    for (const prompt of result.prompts) {
      expect(prompt).toContain('<goal_loop>');
      expect(prompt).toContain('Ziel X');
    }
    expect(result.prompts[0]).toContain('Mach das.');
  });

  test('retains the turn output contract on continuation iterations', async () => {
    const contract = [
      '<claudian_output_contract surface="live-document">',
      'Render exactly one live document.',
      '</claudian_output_contract>',
    ].join('\n');
    const result = await runHarness({
      initialPrompt: `Mach das.\n\n${contract}`,
      turns: [`Entwurf\n${GOAL_CONTINUE_MARKER}`, `Fertig\n${GOAL_DONE_MARKER}`],
    });

    expect(result.prompts).toHaveLength(2);
    expect(result.prompts[0].match(/<claudian_output_contract/g)).toHaveLength(1);
    expect(result.prompts[1].match(/<claudian_output_contract/g)).toHaveLength(1);
    expect(result.prompts[1]).toContain('surface="live-document"');
  });

  test('keeps the stream alive while a slow verifier runs', async () => {
    jest.useFakeTimers();
    try {
      // Held in an object so TS does not narrow the callback away between the
      // Promise executor and the call site below.
      const control: { release: (() => void) | null } = { release: null };
      const slowVerify = (): Promise<GoalVerdict> =>
        new Promise((resolve) => {
          control.release = () => resolve({ done: true, reason: 'ok', nextStep: '', confidence: 1 });
        });

      const run = runHarness({ turns: ['Arbeit ohne Marker'], verify: slowVerify });

      // Two keepalive intervals of silence — long enough for the chat watchdog
      // to have killed the turn without them.
      await Promise.resolve();
      await jest.advanceTimersByTimeAsync(45_000);
      control.release?.();
      jest.useRealTimers();

      const result = await run;
      expect(result.chunks.filter((chunk) => chunk.type === 'keepalive').length).toBeGreaterThan(0);
      expect(result.reason).toBe('achieved');
    } finally {
      jest.useRealTimers();
    }
  });

  test('reports cancellation instead of timeout when cancel arrives during verifier abort grace', async () => {
    jest.useFakeTimers();
    try {
      let cancelled = false;
      const generator = runClineGoalLoop({
        goal: 'Ziel X',
        initialPrompt: 'Mach das.',
        deps: {
          isCancelled: () => cancelled,
          maxIterations: 1,
          runTurn: async function* () {
            yield { type: 'text', content: `Fertig.\n${GOAL_DONE_MARKER}` } as StreamChunk;
            yield { type: 'done' } as StreamChunk;
          },
          verify: async (_goal, _work, signal) => {
            signal.addEventListener('abort', () => {
              window.setTimeout(() => { cancelled = true; }, 5);
            }, { once: true });
            return new Promise<GoalVerdict | null>(() => undefined);
          },
          verificationTimeoutMs: 10,
          verificationAbortGraceMs: 20,
        },
      });
      const chunks: StreamChunk[] = [];
      const consume = (async () => {
        let next = await generator.next();
        while (!next.done) {
          chunks.push(next.value);
          next = await generator.next();
        }
        return next.value;
      })();

      await jest.advanceTimersByTimeAsync(40);
      const result = await consume;
      const notices = chunks.filter((chunk) => chunk.type === 'notice');

      expect(result.reason).toBe('cancelled');
      expect(JSON.stringify(notices)).toContain('abgebrochen');
      expect(JSON.stringify(notices)).not.toContain('Zeitlimit');
    } finally {
      jest.useRealTimers();
    }
  });

  test('keeps the marker out of the transcript but still acts on it', async () => {
    const result = await runHarness({ turns: [`Echte Antwort.\n${GOAL_DONE_MARKER}`] });
    const streamed = result.chunks
      .filter((chunk): chunk is Extract<StreamChunk, { type: 'text' }> => chunk.type === 'text')
      .map((chunk) => chunk.content)
      .join('');

    expect(streamed).toContain('Echte Antwort.');
    expect(streamed).not.toContain(GOAL_DONE_MARKER);
    expect(result.reason).toBe('achieved');
  });

  test('does not swallow a line that merely mentions a marker', async () => {
    const result = await runHarness({
      turns: [`Ich schreibe am Ende ${GOAL_DONE_MARKER}, wenn ich fertig bin.`],
      maxIterations: 1,
    });
    const streamed = result.chunks
      .filter((chunk): chunk is Extract<StreamChunk, { type: 'text' }> => chunk.type === 'text')
      .map((chunk) => chunk.content)
      .join('');

    expect(streamed).toContain('wenn ich fertig bin.');
  });

  test('surfaces the outcome as a closing notice', async () => {
    const result = await runHarness({ turns: [`fertig\n${GOAL_DONE_MARKER}`] });
    const notices = result.chunks.filter((chunk) => chunk.type === 'notice');

    expect(notices[notices.length - 1]).toMatchObject({ level: 'info' });
    expect(JSON.stringify(notices)).toContain('Ziel erreicht');
  });
});
