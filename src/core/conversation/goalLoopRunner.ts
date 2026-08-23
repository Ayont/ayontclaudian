import type { StreamChunk } from '../types';
import {
  buildGoalContinuationPrompt,
  buildGoalLoopDirective,
  describeGoalLoopOutcome,
  detectGoalMarker,
  GOAL_CONTINUE_MARKER,
  GOAL_DONE_MARKER,
  type GoalLoopStopReason,
  type GoalVerdict,
  isStalledIteration,
} from './goalLoop';

/**
 * Drives Cline turns until a standing `/goal` is actually reached.
 *
 * The loop is a generator over stream chunks so the chat surface renders each
 * iteration live, exactly like a normal turn. Turn execution and verification are
 * injected, which keeps the CLI (process spawning, NDJSON parsing) out of the
 * control flow and makes every stop condition unit-testable.
 */
export interface GoalLoopRunnerDeps {
  /** Checked before each continuation iteration; true suspends the loop
   *  without clearing the goal (resume starts a fresh turn later). */
  isPaused?: () => boolean;
  /** Runs ONE CLI turn and streams its chunks. */
  runTurn: (
    prompt: string,
    options: { echoUserMessage: boolean },
  ) => AsyncGenerator<StreamChunk>;
  /**
   * Skeptical second opinion on whether the goal is reached. Null disables
   * verification (marker-only mode). Resolving to null means "no usable verdict"
   * — the loop then trusts the agent's own marker.
   */
  verify: ((goal: string, work: string) => Promise<GoalVerdict | null>) | null;
  /** True once the user cancelled the turn. */
  isCancelled: () => boolean;
  maxIterations: number;
}

export interface GoalLoopRunnerResult {
  iterations: number;
  reason: GoalLoopStopReason;
}

/** Matches a line that is nothing but a completion marker, with optional decoration. */
const MARKER_ONLY_LINE = new RegExp(
  `^[*_\`>\\s-]*(?:${GOAL_DONE_MARKER}|${GOAL_CONTINUE_MARKER})[*_\`\\s]*$`,
);

/**
 * Drops a buffered trailing line when it is nothing but a control marker.
 *
 * The markers are how the agent talks to the loop, not to the user — leaving
 * them in the transcript would end every iteration with a stray "GOAL_CONTINUE".
 * Only a marker-ONLY line is removed; a line that merely mentions the word keeps
 * its text.
 */
function flushTail(tail: string): string {
  if (!tail) return '';
  return MARKER_ONLY_LINE.test(tail) ? '' : tail;
}

/** Accumulated work handed to the verifier: every iteration's visible output. */
function appendWork(previous: string, iteration: number, text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return previous;
  return `${previous}${previous ? '\n\n' : ''}### Durchlauf ${iteration}\n${trimmed}`;
}

export async function* runGoalLoopRunner(params: {
  goal: string;
  initialPrompt: string;
  deps: GoalLoopRunnerDeps;
}): AsyncGenerator<StreamChunk, GoalLoopRunnerResult> {
  const { goal, initialPrompt, deps } = params;
  const maxIterations = Math.max(1, deps.maxIterations);

  let work = '';
  let previousIterationText = '';
  let verdict: GoalVerdict | null = null;
  let iteration = 0;
  let stop: GoalLoopStopReason = 'max-iterations';

  while (iteration < maxIterations) {
    iteration += 1;

    const body = iteration === 1
      ? initialPrompt
      : buildGoalContinuationPrompt(goal, verdict, iteration, maxIterations);
    const prompt = `${body}\n\n${buildGoalLoopDirective(goal, iteration, maxIterations)}`;

    if (iteration > 1) {
      yield {
        type: 'notice',
        content: `🔁 Goal-Loop · Durchlauf ${iteration}/${maxIterations}${verdict?.nextStep ? ` — ${verdict.nextStep}` : ''}`,
        level: 'info',
      };
    }

    let iterationText = '';
    let iterationErrored = false;
    // Holds back the not-yet-terminated last line so a trailing control marker
    // can be removed before it reaches the transcript (see flushTail below).
    let tail = '';

    for await (const chunk of deps.runTurn(prompt, { echoUserMessage: iteration === 1 })) {
      if (chunk.type === 'text') {
        iterationText += chunk.content;
        tail += chunk.content;
        const lastBreak = tail.lastIndexOf('\n');
        if (lastBreak === -1) continue;
        const complete = tail.slice(0, lastBreak + 1);
        tail = tail.slice(lastBreak + 1);
        if (complete) yield { type: 'text', content: complete };
        continue;
      }
      if (chunk.type === 'error') {
        iterationErrored = true;
      } else if (chunk.type === 'done') {
        // The loop owns the single terminal `done`; per-iteration ones are swallowed.
        continue;
      }
      // A non-text chunk (tool call, usage, …) must not jump ahead of buffered
      // text, so the tail is flushed before it goes out.
      const flushed = flushTail(tail);
      tail = '';
      if (flushed) yield { type: 'text', content: flushed };
      yield chunk;
    }

    const remaining = flushTail(tail);
    if (remaining) yield { type: 'text', content: remaining };

    work = appendWork(work, iteration, iterationText);

    if (deps.isPaused?.()) {
      stop = 'paused';
      yield { type: 'notice', content: '⏸️ Goal-Loop pausiert — mit /goal resume fortsetzen.', level: 'warning' };
      break;
    }
    if (deps.isCancelled()) {
      stop = 'cancelled';
      break;
    }
    if (iterationErrored) {
      stop = 'error';
      break;
    }

    const marker = detectGoalMarker(iterationText);
    verdict = yield* resolveVerdict({ deps, goal, work, marker });

    if (verdict?.done) {
      stop = 'achieved';
      break;
    }

    if (isStalledIteration(previousIterationText, iterationText)) {
      stop = 'stalled';
      break;
    }
    previousIterationText = iterationText;
  }

  yield {
    type: 'notice',
    content: describeGoalLoopOutcome(stop, iteration, verdict?.reason),
    level: stop === 'achieved' ? 'info' : 'warning',
  };
  yield { type: 'done' };

  return { iterations: iteration, reason: stop };
}

/**
 * Combines the agent's self-reported marker with the verifier.
 *
 * A `GOAL_CONTINUE` marker is trusted immediately — the agent knows it is not
 * finished, and paying for a verifier call to confirm that is waste. Everything
 * else goes to the verifier when one is wired, because agents claim completion
 * far too eagerly. Without a verifier the marker decides alone.
 */
async function* resolveVerdict(params: {
  deps: GoalLoopRunnerDeps;
  goal: string;
  work: string;
  marker: 'done' | 'continue' | null;
}): AsyncGenerator<StreamChunk, GoalVerdict | null> {
  const { deps, goal, work, marker } = params;

  if (marker === 'continue') {
    return { done: false, reason: 'Der Agent meldet offene Arbeit.', nextStep: '', confidence: 0.9 };
  }

  if (deps.verify) {
    const verified = yield* awaitWithKeepalive(deps.verify(goal, work));
    if (verified) return verified;
  }

  if (marker === 'done') {
    return { done: true, reason: 'Der Agent meldet das Ziel als erreicht.', nextStep: '', confidence: 0.6 };
  }
  return { done: false, reason: 'Kein Abschluss-Signal erkannt.', nextStep: '', confidence: 0.4 };
}

/** Keepalive cadence during the verifier call — well inside the chat watchdog's window. */
const VERIFY_KEEPALIVE_INTERVAL_MS = 20_000;

/**
 * Awaits the verifier while emitting keepalives.
 *
 * Verification happens between two streamed turns, so nothing reaches the chat
 * while it runs. The stream watchdog force-cancels after two minutes of silence,
 * which would kill a healthy loop mid-verification — these keepalives are what
 * keep the turn alive. A failed verification resolves to null so the loop can
 * fall back to the agent's own marker.
 */
async function* awaitWithKeepalive(
  promise: Promise<GoalVerdict | null>,
): AsyncGenerator<StreamChunk, GoalVerdict | null> {
  let settled = false;
  let result: GoalVerdict | null = null;

  const task = promise.then(
    (value) => { result = value; settled = true; },
    () => { result = null; settled = true; },
  );

  while (!settled) {
    let timeoutId = 0;
    const tick = new Promise<void>((resolve) => {
      timeoutId = window.setTimeout(resolve, VERIFY_KEEPALIVE_INTERVAL_MS);
    });
    await Promise.race([task, tick]);
    window.clearTimeout(timeoutId);
    if (!settled) {
      yield { type: 'keepalive' };
    }
  }

  await task;
  return result;
}