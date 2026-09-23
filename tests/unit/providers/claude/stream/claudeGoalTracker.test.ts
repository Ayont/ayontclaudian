import { ClaudeGoalTracker, parseGoalCommandPrompt } from '@/providers/claude/stream/claudeGoalTracker';
import { transformSDKMessage } from '@/providers/claude/stream/transformClaudeMessage';

const CONDITION = 'count.txt contains the number 2';

// Real shape, recorded from Claude Code 2.1.280 in streaming-input mode.
function stopHookFeedback(condition: string, reason: string) {
  return {
    type: 'user',
    parent_tool_use_id: null,
    session_id: 's',
    message: { role: 'user', content: [{ type: 'text', text: `Stop hook feedback:\n[${condition}]: ${reason}` }] },
  } as never;
}

function collect(message: unknown, tracker: ClaudeGoalTracker) {
  return [...transformSDKMessage(message as never, { goalTracker: tracker })];
}

describe('parseGoalCommandPrompt', () => {
  it('reads a condition and the clear form', () => {
    expect(parseGoalCommandPrompt(`/goal ${CONDITION}`)).toEqual({ kind: 'set', condition: CONDITION });
    expect(parseGoalCommandPrompt('/goal clear')).toEqual({ kind: 'clear' });
    expect(parseGoalCommandPrompt('/goals are nice')).toBeNull();
    expect(parseGoalCommandPrompt('mach weiter')).toBeNull();
  });
});

describe('ClaudeGoalTracker in the SDK stream', () => {
  it('counts a Stop-hook "not yet met" verdict on its own condition as the next round', () => {
    const tracker = new ClaudeGoalTracker();
    tracker.begin(CONDITION);

    const events = collect(stopHookFeedback(CONDITION, 'Die Datei enthält noch 1.'), tracker);

    expect(events).toEqual([{
      type: 'goal_update',
      round: 2,
      goal: { objective: CONDITION, status: 'active', round: 2, lastReason: 'Die Datei enthält noch 1.' },
    }]);
  });

  it('ignores Stop-hook feedback from other hooks', () => {
    const tracker = new ClaudeGoalTracker();
    tracker.begin(CONDITION);

    expect(collect(stopHookFeedback('lint must pass', 'nope'), tracker)).toEqual([]);
  });

  it('ignores Stop-hook feedback when no goal is active', () => {
    expect(collect(stopHookFeedback(CONDITION, 'nope'), new ClaudeGoalTracker())).toEqual([]);
  });

  it('reports the goal complete when the answer finishes, and forgets it', () => {
    const tracker = new ClaudeGoalTracker();
    tracker.begin(CONDITION);

    const events = collect({ type: 'result', subtype: 'success', is_error: false, result: 'ok' }, tracker);

    expect(events).toContainEqual({ type: 'goal_update', goal: expect.objectContaining({ status: 'complete', objective: CONDITION }) });
    expect(tracker.current()).toBeNull();
  });

  it('reports a goal that ended with an error as blocked', () => {
    const tracker = new ClaudeGoalTracker();
    tracker.begin(CONDITION);

    const events = collect({ type: 'result', subtype: 'error_max_turns', is_error: true, errors: [] }, tracker);

    expect(events).toContainEqual({ type: 'goal_update', goal: expect.objectContaining({ status: 'blocked' }) });
  });

  it('follows active_goal messages when the CLI sends them', () => {
    const tracker = new ClaudeGoalTracker();
    tracker.begin(CONDITION);

    const events = collect({
      type: 'active_goal',
      value: { condition: CONDITION, iterations: 3, set_at: 1, tokens_at_start: 0, last_reason: 'fast' },
      uuid: 'u',
      session_id: 's',
    }, tracker);

    expect(events).toEqual([{
      type: 'goal_update',
      round: 3,
      goal: { objective: CONDITION, status: 'active', round: 3, lastReason: 'fast' },
    }]);
  });

  it('reports a stopped goal as paused and keeps following it into the next answer', () => {
    const tracker = new ClaudeGoalTracker();
    tracker.begin(CONDITION);
    tracker.markInterrupted();

    const events = collect({ type: 'result', subtype: 'error_during_execution', is_error: true, errors: [] }, tracker);

    expect(events).toContainEqual({ type: 'goal_update', goal: expect.objectContaining({ status: 'paused' }) });
    expect(tracker.current()).toEqual(expect.objectContaining({ status: 'active', objective: CONDITION }));
  });
});
