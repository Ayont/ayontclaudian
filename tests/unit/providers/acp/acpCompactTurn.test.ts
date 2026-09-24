import type { UsageInfo } from '@/core/types';
import { finishAcpTurnChunks, isAcpCompactPrompt } from '@/providers/acp/acpCompactTurn';

const usage: UsageInfo = {
  model: 'm',
  inputTokens: 1,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
  contextWindow: 200_000,
  contextTokens: 150_000,
  percentage: 75,
};

describe('isAcpCompactPrompt', () => {
  it('matches the bare command and one with a focus', () => {
    expect(isAcpCompactPrompt('/compact', '/compact')).toBe(true);
    expect(isAcpCompactPrompt('  /Compact keep the auth details', '/compact')).toBe(true);
    expect(isAcpCompactPrompt('/compress', '/compress')).toBe(true);
  });

  it('ignores lookalikes and ordinary text', () => {
    expect(isAcpCompactPrompt('/compactfoo', '/compact')).toBe(false);
    expect(isAcpCompactPrompt('please /compact this', '/compact')).toBe(false);
    expect(isAcpCompactPrompt('/compact', undefined)).toBe(false);
  });
});

describe('finishAcpTurnChunks', () => {
  it('passes an ordinary turn through unchanged', () => {
    expect(finishAcpTurnChunks({ compacted: false, usage, sessionId: 's' })).toEqual([
      { sessionId: 's', type: 'usage', usage },
    ]);
  });

  it('marks the boundary before the usage of a compact turn', () => {
    expect(finishAcpTurnChunks({ compacted: true, usage, sessionId: 's', freshFill: true })).toEqual([
      { type: 'context_compacted' },
      { sessionId: 's', type: 'usage', usage },
    ]);
  });

  it('keeps a summary call out of the meter when the agent reports no fresh fill', () => {
    expect(finishAcpTurnChunks({ compacted: true, usage, sessionId: 's' })).toEqual([
      { type: 'context_compacted' },
      { sessionId: 's', type: 'usage', usage, contextDisplay: 'preserve' },
    ]);
  });

  it('still marks the boundary when there is no usage', () => {
    expect(finishAcpTurnChunks({ compacted: true, usage: null, sessionId: 's' })).toEqual([
      { type: 'context_compacted' },
    ]);
  });
});
