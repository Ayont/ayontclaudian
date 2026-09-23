/**
 * Provider-native goals: when the provider has its own goal system (Codex
 * `thread/goal/*`, Claude Code's `/goal`, kimi-code's headless `/goal`),
 * Claudian hands `/goal` to it instead of framing the goal into prompts and
 * looping itself. Pure decisions only; the chat carries them out.
 */

import type { NativeGoalCapability } from '../providers/types';
import type { NativeGoalAction } from '../runtime/ChatRuntime';
import type { NativeGoalState } from '../types';
import type { GoalCommand } from './goalPrompt';

export function resolveNativeGoalSupport(
  capabilities: { nativeGoal?: NativeGoalCapability } | null | undefined,
  runtime: { supportsNativeGoal?: () => boolean } | null | undefined,
): NativeGoalCapability | null {
  const capability = capabilities?.nativeGoal;
  if (!capability) return null;
  if (runtime?.supportsNativeGoal && !runtime.supportsNativeGoal()) return null;
  return capability;
}

/**
 * True while the chat runs on the provider that owns its goal. After a switch
 * to another provider the goal text falls back to Claudian's own loop.
 */
export function isGoalOwnedByProvider(
  conversation: { goal?: string | null; goalProviderId?: string | null } | null | undefined,
  providerId: string,
): boolean {
  return Boolean(conversation?.goal && conversation.goalProviderId && conversation.goalProviderId === providerId);
}

export type NativeGoalCommandPlan =
  /** Send a turn. `raw` bypasses Claudian's built-ins and prompt decoration. */
  | { kind: 'send'; content: string; raw?: true; queue?: NativeGoalAction }
  | { kind: 'rpc-pause' }
  | { kind: 'rpc-clear' }
  /** The provider has no way to end it; only Claudian forgets the goal. */
  | { kind: 'local-clear' }
  | { kind: 'notice'; message: string };

const RESUME_PROMPT = 'Setze die Arbeit am Ziel fort.';

export function planNativeGoalCommand(
  capability: NativeGoalCapability,
  command: GoalCommand,
  currentGoal: string | null,
  providerLabel = 'Dieser Anbieter',
): NativeGoalCommandPlan {
  switch (command.action) {
    case 'set': {
      const objective = (command.goal ?? '').trim();
      if (capability.mode === 'rpc') {
        return { kind: 'send', content: objective, queue: { kind: 'set', objective } };
      }
      return { kind: 'send', content: `/goal ${objective}`, raw: true };
    }
    case 'clear':
      if (capability.mode === 'rpc') return { kind: 'rpc-clear' };
      return capability.clearCommand
        ? { kind: 'send', content: capability.clearCommand, raw: true }
        : { kind: 'local-clear' };
    case 'pause':
      return capability.canPause
        ? { kind: 'rpc-pause' }
        : { kind: 'notice', message: `${providerLabel} kann ein Ziel nicht pausieren. /goal clear beendet es.` };
    case 'resume':
      if (capability.resume === 'rpc') {
        return { kind: 'send', content: RESUME_PROMPT, queue: { kind: 'resume' } };
      }
      if (capability.resume === 'next-turn') {
        return { kind: 'notice', message: `${providerLabel} arbeitet mit der nächsten Nachricht am Ziel weiter.` };
      }
      return currentGoal
        ? { kind: 'send', content: `/goal ${currentGoal}`, raw: true }
        : { kind: 'notice', message: 'Kein Ziel zum Fortsetzen gesetzt.' };
  }
}

export interface NativeGoalDescription {
  label: string;
  /** Second line: why the last check failed, or budget and time used. */
  detail: string;
  tone: 'live' | 'success' | 'warning' | 'danger' | 'muted';
}

const STATUS_LABEL: Record<NativeGoalState['status'], { label: string; tone: NativeGoalDescription['tone'] }> = {
  active: { label: 'Ziel aktiv', tone: 'live' },
  paused: { label: 'Ziel pausiert', tone: 'muted' },
  blocked: { label: 'Ziel blockiert', tone: 'danger' },
  usage_limited: { label: 'Nutzungslimit erreicht', tone: 'warning' },
  budget_limited: { label: 'Token-Budget erschöpft', tone: 'warning' },
  complete: { label: 'Ziel erreicht', tone: 'success' },
};

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '').replace('.', ',')}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, '').replace('.', ',')}k`;
  return String(Math.round(value));
}

export function describeNativeGoal(goal: NativeGoalState): NativeGoalDescription {
  const status = STATUS_LABEL[goal.status] ?? STATUS_LABEL.active;
  const label = goal.status === 'active' && goal.round && goal.round > 1
    ? `${status.label} · Runde ${goal.round}`
    : status.label;

  if (goal.status === 'active' && goal.lastReason) {
    return { label, detail: `Noch nicht erfüllt: ${goal.lastReason}`, tone: status.tone };
  }
  if (goal.status === 'complete') {
    return { label, detail: '', tone: status.tone };
  }

  const parts: string[] = [];
  if (typeof goal.tokensUsed === 'number' && goal.tokensUsed > 0) {
    parts.push(goal.tokenBudget
      ? `${formatTokens(goal.tokensUsed)} / ${formatTokens(goal.tokenBudget)} Tokens`
      : `${formatTokens(goal.tokensUsed)} Tokens`);
  }
  if (typeof goal.timeUsedSeconds === 'number' && goal.timeUsedSeconds >= 60) {
    parts.push(`${Math.round(goal.timeUsedSeconds / 60)} Min.`);
  }
  return { label, detail: parts.join(' · '), tone: status.tone };
}
