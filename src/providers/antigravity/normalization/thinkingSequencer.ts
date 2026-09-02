import type { StreamChunk } from '../../../core/types';

/**
 * Orders transcript `thinking` against stream-json text for the same step.
 *
 * agy runs two channels: stream-json delivers `agent_response` text deltas as
 * they are generated, while the per-conversation transcript.jsonl carries the
 * planner row — the only place the model's `thinking` lives — and lands a poll
 * or two later. Both label the row with the same `step_index`.
 *
 * Emitting the thinking the moment the transcript shows it puts it in the
 * middle of a text run. The chat controller closes the open text block on a
 * thinking chunk, so a fence that was split across deltas (``` ```powershel``` +
 * ```l\n…```) renders as broken markup. This sequencer holds a step's thinking
 * while that step's text is still streaming and releases it once the step is
 * DONE (before any later step) — thinking is shown after its answer, in one
 * piece, instead of tearing the answer apart.
 *
 * Thinking for a step whose text has not started streaming is released at once:
 * that is the normal "reasoning first" order and needs no reordering.
 */
export interface AgyThinkingSequencer {
  /** Text delta from stream-json for `stepIndex`. */
  noteStreamText(stepIndex: number): void;
  /** Stream-json reported `state: 'DONE'` for `stepIndex`. Returns released chunks. */
  noteStreamStepDone(stepIndex: number): StreamChunk[];
  /**
   * A thinking chunk arrived from the transcript for `stepIndex`. Returns the
   * chunks to emit now (possibly none if held).
   */
  offerThinking(stepIndex: number, chunk: StreamChunk): StreamChunk[];
  /** End of turn: release everything still held, in step order. */
  flush(): StreamChunk[];
}

export function createAgyThinkingSequencer(): AgyThinkingSequencer {
  const streamingSteps = new Set<number>();
  const doneSteps = new Set<number>();
  const held = new Map<number, StreamChunk>();

  const release = (stepIndex: number): StreamChunk[] => {
    const chunk = held.get(stepIndex);
    if (!chunk) return [];
    held.delete(stepIndex);
    return [chunk];
  };

  return {
    noteStreamText(stepIndex) {
      if (!doneSteps.has(stepIndex)) streamingSteps.add(stepIndex);
    },
    noteStreamStepDone(stepIndex) {
      streamingSteps.delete(stepIndex);
      doneSteps.add(stepIndex);
      return release(stepIndex);
    },
    offerThinking(stepIndex, chunk) {
      if (streamingSteps.has(stepIndex) && !doneSteps.has(stepIndex)) {
        held.set(stepIndex, chunk);
        return [];
      }
      return [chunk];
    },
    flush() {
      const steps = [...held.keys()].sort((a, b) => a - b);
      return steps.flatMap((step) => release(step));
    },
  };
}
