import type { NativeGoalState, StreamChunk } from '../../../core/types';

type GoalUpdateChunk = Extract<StreamChunk, { type: 'goal_update' }>;

/**
 * The Stop hook behind Claude Code's `/goal` injects this user message when
 * the condition is not met yet and Claude keeps working (recorded from
 * 2.1.280): `Stop hook feedback:\n[<condition>]: <reason>`.
 */
const STOP_HOOK_FEEDBACK = /^Stop hook feedback:\s*\n\[([\s\S]*?)\]:\s*([\s\S]*)$/;

export type GoalCommandPrompt = { kind: 'set'; condition: string } | { kind: 'clear' };

/** Reads Claude Code's `/goal <condition>` and `/goal clear` from a prompt. */
export function parseGoalCommandPrompt(prompt: string): GoalCommandPrompt | null {
  const match = /^\/goal(?:\s+([\s\S]*))?$/.exec(prompt.trim());
  if (!match) return null;
  const argument = (match[1] ?? '').trim();
  if (!argument || argument.toLowerCase() === 'clear') return { kind: 'clear' };
  return { kind: 'set', condition: argument };
}

/**
 * Follows one Claude Code goal through its rounds. The goal loop itself runs
 * inside Claude Code; this only turns what the stream shows of it into
 * provider-neutral goal updates.
 */
export class ClaudeGoalTracker {
  private state: NativeGoalState | null = null;
  private interrupted = false;

  begin(condition: string): NativeGoalState {
    this.state = { objective: condition, status: 'active', round: 1 };
    return this.state;
  }

  clear(): void {
    this.state = null;
    this.interrupted = false;
  }

  /** The user stopped the answer; Claude Code keeps the goal and checks it at the next stop. */
  markInterrupted(): void {
    if (this.state) this.interrupted = true;
  }

  current(): NativeGoalState | null {
    return this.state;
  }

  /** A user message of the stream; returns the next round if it is our goal's verdict. */
  fromUserText(text: string): GoalUpdateChunk | null {
    if (!this.state) return null;
    const match = STOP_HOOK_FEEDBACK.exec(text.trim());
    if (!match || match[1].trim() !== this.state.objective.trim()) return null;
    const round = (this.state.round ?? 1) + 1;
    this.state = { ...this.state, round, lastReason: match[2].trim() };
    return { type: 'goal_update', goal: this.state, round };
  }

  fromActiveGoal(value: { condition?: unknown; iterations?: unknown; last_reason?: unknown } | null): GoalUpdateChunk | null {
    if (!value) {
      const finished = this.state ? { ...this.state, status: 'complete' as const } : null;
      this.state = null;
      return finished ? { type: 'goal_update', goal: finished } : null;
    }
    const objective = typeof value.condition === 'string' ? value.condition : this.state?.objective;
    if (!objective) return null;
    const round = typeof value.iterations === 'number' && value.iterations > 0 ? value.iterations : this.state?.round ?? 1;
    this.state = {
      objective,
      status: 'active',
      round,
      ...(typeof value.last_reason === 'string' && value.last_reason ? { lastReason: value.last_reason } : {}),
    };
    return { type: 'goal_update', goal: this.state, round };
  }

  /** The answer ended. Claude Code only lets it end once the condition holds. */
  settle(failed: boolean): GoalUpdateChunk | null {
    if (!this.state) return null;
    if (this.interrupted) {
      // Still set inside Claude Code: the next answer keeps working on it.
      this.interrupted = false;
      return { type: 'goal_update', goal: { ...this.state, status: 'paused' } };
    }
    const finished: NativeGoalState = { ...this.state, status: failed ? 'blocked' : 'complete' };
    this.state = null;
    return { type: 'goal_update', goal: finished };
  }
}
