import {
  describeNativeGoal,
  isGoalOwnedByProvider,
  planNativeGoalCommand,
  resolveNativeGoalSupport,
} from '@/core/conversation/nativeGoal';
import type { NativeGoalCapability } from '@/core/providers/types';

const CODEX: NativeGoalCapability = { mode: 'rpc', canPause: true, persistent: true, resume: 'rpc' };
const CLAUDE: NativeGoalCapability = { mode: 'slash', canPause: false, persistent: false, clearCommand: '/goal clear', resume: 'next-turn' };
const KIMI: NativeGoalCapability = { mode: 'slash', canPause: false, persistent: true, resume: 'resend' };

describe('resolveNativeGoalSupport', () => {
  it('uses the declared capability unless the runtime says the CLI lacks it', () => {
    expect(resolveNativeGoalSupport({ nativeGoal: CODEX }, null)).toBe(CODEX);
    expect(resolveNativeGoalSupport({ nativeGoal: CLAUDE }, { supportsNativeGoal: () => false })).toBeNull();
    expect(resolveNativeGoalSupport({ nativeGoal: CLAUDE }, { supportsNativeGoal: () => true })).toBe(CLAUDE);
    expect(resolveNativeGoalSupport({}, { supportsNativeGoal: () => true })).toBeNull();
  });
});

describe('planNativeGoalCommand', () => {
  it('sets a Codex goal on the thread and sends the objective as the turn', () => {
    expect(planNativeGoalCommand(CODEX, { action: 'set', goal: 'Tests grün' }, null)).toEqual({
      kind: 'send',
      content: 'Tests grün',
      queue: { kind: 'set', objective: 'Tests grün' },
    });
  });

  it('hands Claude and Kimi their own /goal command, untouched by Claudian', () => {
    expect(planNativeGoalCommand(CLAUDE, { action: 'set', goal: 'Tests grün' }, null))
      .toEqual({ kind: 'send', content: '/goal Tests grün', raw: true });
    expect(planNativeGoalCommand(KIMI, { action: 'set', goal: 'Tests grün' }, null))
      .toEqual({ kind: 'send', content: '/goal Tests grün', raw: true });
  });

  it('clears through the provider where it can, otherwise only in Claudian', () => {
    expect(planNativeGoalCommand(CODEX, { action: 'clear', goal: null }, 'x')).toEqual({ kind: 'rpc-clear' });
    expect(planNativeGoalCommand(CLAUDE, { action: 'clear', goal: null }, 'x')).toEqual({ kind: 'send', content: '/goal clear', raw: true });
    expect(planNativeGoalCommand(KIMI, { action: 'clear', goal: null }, 'x')).toEqual({ kind: 'local-clear' });
  });

  it('pauses only where the provider can pause', () => {
    expect(planNativeGoalCommand(CODEX, { action: 'pause', goal: null }, 'x')).toEqual({ kind: 'rpc-pause' });
    expect(planNativeGoalCommand(CLAUDE, { action: 'pause', goal: null }, 'x')).toEqual({
      kind: 'notice',
      message: expect.stringContaining('kann ein Ziel nicht pausieren'),
    });
  });

  it('resumes the way each provider continues an interrupted goal', () => {
    expect(planNativeGoalCommand(CODEX, { action: 'resume', goal: null }, 'Tests grün')).toEqual({
      kind: 'send',
      content: 'Setze die Arbeit am Ziel fort.',
      queue: { kind: 'resume' },
    });
    expect(planNativeGoalCommand(KIMI, { action: 'resume', goal: null }, 'Tests grün'))
      .toEqual({ kind: 'send', content: '/goal Tests grün', raw: true });
    expect(planNativeGoalCommand(CLAUDE, { action: 'resume', goal: null }, 'Tests grün')).toEqual({
      kind: 'notice',
      message: expect.stringContaining('nächsten Nachricht'),
    });
    expect(planNativeGoalCommand(KIMI, { action: 'resume', goal: null }, null)).toEqual({
      kind: 'notice',
      message: expect.stringContaining('Kein Ziel'),
    });
  });
});

describe('isGoalOwnedByProvider', () => {
  it('is true only while the chat runs on the provider that owns the goal', () => {
    expect(isGoalOwnedByProvider({ goal: 'x', goalProviderId: 'codex' }, 'codex')).toBe(true);
    expect(isGoalOwnedByProvider({ goal: 'x', goalProviderId: 'codex' }, 'claude')).toBe(false);
    expect(isGoalOwnedByProvider({ goal: 'x' }, 'codex')).toBe(false);
    expect(isGoalOwnedByProvider(null, 'codex')).toBe(false);
  });
});

describe('describeNativeGoal', () => {
  it('names status, round, reason and budget in German', () => {
    expect(describeNativeGoal({ objective: 'x', status: 'active', round: 3, lastReason: 'Test 4 rot' })).toEqual({
      label: 'Ziel aktiv · Runde 3',
      detail: 'Noch nicht erfüllt: Test 4 rot',
      tone: 'live',
    });
    expect(describeNativeGoal({ objective: 'x', status: 'complete' })).toEqual({ label: 'Ziel erreicht', detail: '', tone: 'success' });
    expect(describeNativeGoal({ objective: 'x', status: 'budget_limited', tokensUsed: 51_200, tokenBudget: 50_000 }))
      .toEqual({ label: 'Token-Budget erschöpft', detail: '51,2k / 50k Tokens', tone: 'warning' });
    expect(describeNativeGoal({ objective: 'x', status: 'active', tokensUsed: 1_200, tokenBudget: null, timeUsedSeconds: 185 }))
      .toEqual({ label: 'Ziel aktiv', detail: '1,2k Tokens · 3 Min.', tone: 'live' });
  });
});
