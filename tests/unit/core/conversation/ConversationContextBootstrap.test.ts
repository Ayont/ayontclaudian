import {
  buildCondensedContextCarry,
  buildConversationContextBootstrap,
  buildProviderSwitchCarry,
  computeBootstrapCharCap,
  computeCondensedCarryCharBudget,
  CONDENSED_CARRY_WINDOW_SHARE,
  condensedCarryOmitsTurns,
  CONTEXT_BOOTSTRAP_CHAR_CAP,
} from '@/core/conversation/ConversationContextBootstrap';
import type { ChatMessage } from '@/core/types';

describe('computeBootstrapCharCap', () => {
  it('falls back to the floor for unknown/invalid windows', () => {
    expect(computeBootstrapCharCap(undefined)).toBe(CONTEXT_BOOTSTRAP_CHAR_CAP);
    expect(computeBootstrapCharCap(0)).toBe(CONTEXT_BOOTSTRAP_CHAR_CAP);
    expect(computeBootstrapCharCap(-5)).toBe(CONTEXT_BOOTSTRAP_CHAR_CAP);
    expect(computeBootstrapCharCap(Number.NaN)).toBe(CONTEXT_BOOTSTRAP_CHAR_CAP);
  });

  it('uses the full character budget of a known window', () => {
    // 32k tokens → 32000*4 characters. A fitting transcript must not stop at the old 6k floor.
    expect(computeBootstrapCharCap(32000)).toBe(128_000);
    expect(computeBootstrapCharCap(200_000)).toBe(800_000);
    expect(computeBootstrapCharCap(1_000_000)).toBe(4_000_000);
  });
});

function userMsg(content: string, id = `u-${content.length}-${Math.random()}`): ChatMessage {
  return { id, role: 'user', content, timestamp: 1 };
}

function assistantMsg(content: string, id = `a-${content.length}-${Math.random()}`): ChatMessage {
  return { id, role: 'assistant', content, timestamp: 2, toolCalls: [], contentBlocks: [] };
}

describe('buildConversationContextBootstrap', () => {
  it('returns empty string for empty history', () => {
    expect(buildConversationContextBootstrap([])).toBe('');
  });

  it('returns empty string when history has no renderable content', () => {
    // Empty assistant message with no tool calls / thinking is skipped by the formatter.
    expect(buildConversationContextBootstrap([assistantMsg('')])).toBe('');
  });

  it('frames the snapshot in <conversation_context> tags', () => {
    const out = buildConversationContextBootstrap([
      userMsg('Hello there'),
      assistantMsg('General Kenobi'),
    ]);
    expect(out.startsWith('<conversation_context>')).toBe(true);
    expect(out.trimEnd().endsWith('</conversation_context>')).toBe(true);
  });

  it('keeps recent turns verbatim with oldest-last ordering', () => {
    const out = buildConversationContextBootstrap([
      userMsg('first question'),
      assistantMsg('first answer'),
      userMsg('second question'),
      assistantMsg('second answer'),
    ]);
    expect(out).toContain('first question');
    expect(out).toContain('second answer');
    // Oldest before newest.
    expect(out.indexOf('first question')).toBeLessThan(out.indexOf('second question'));
    expect(out.indexOf('second question')).toBeLessThan(out.indexOf('second answer'));
  });

  it('uses User:/Assistant: role framing from the shared formatter', () => {
    const out = buildConversationContextBootstrap([
      userMsg('ping'),
      assistantMsg('pong'),
    ]);
    expect(out).toContain('User: ping');
    expect(out).toContain('Assistant: pong');
  });

  it('honors the default char cap', () => {
    const big = 'x'.repeat(20_000);
    const out = buildConversationContextBootstrap([
      userMsg(big),
      assistantMsg(big),
      userMsg('latest short turn'),
    ]);
    // Hard bound: framed payload must not blow past the cap (+ small tag overhead).
    const tagOverhead = '<conversation_context>\n\n</conversation_context>'.length;
    expect(out.length).toBeLessThanOrEqual(CONTEXT_BOOTSTRAP_CHAR_CAP + tagOverhead);
  });

  it('marks dropped older turns with an omitted note', () => {
    const big = 'y'.repeat(20_000);
    const out = buildConversationContextBootstrap([
      userMsg(big),
      assistantMsg('older answer that gets dropped'),
      userMsg('most recent question'),
    ]);
    expect(out).toContain('[earlier turns omitted]');
    expect(out).toContain('most recent question');
  });

  it('keeps the full history when it already fits and adds no omitted note', () => {
    const out = buildConversationContextBootstrap([
      userMsg('short q'),
      assistantMsg('short a'),
    ]);
    expect(out).not.toContain('[earlier turns omitted]');
  });

  it('omits only the overflow past the target window and marks it', () => {
    const newest = 'NEWEST-TURN-MUST-REMAIN';
    const older = `OLDER-TURN-${'z'.repeat(12_000)}`;
    const out = buildProviderSwitchCarry({
      messages: [
        { id: 'old', role: 'user', content: older, timestamp: 1 },
        { id: 'new', role: 'user', content: newest, timestamp: 2 },
      ],
      contextWindowTokens: 1_000,
    });
    expect(out).toContain('[earlier turns omitted]');
    expect(out).toContain(newest);
    expect(out).not.toContain('OLDER-TURN');
    expect(out.length).toBeLessThan(24_000);
  });

  it('keeps a long file path and stored outcome that fit the target window', () => {
    const filePath = `vault/${'p'.repeat(144)}`;
    const outcome = 'R'.repeat(2000);
    const out = buildProviderSwitchCarry({
      messages: [
        { id: 'u', role: 'user', content: 'write the plan', timestamp: 1 },
        {
          id: 'a',
          role: 'assistant',
          content: 'wrote it',
          timestamp: 2,
          toolCalls: [{
            id: 'tool-write',
            name: 'Write',
            input: { file_path: filePath },
            status: 'completed',
            result: outcome,
          }],
        },
      ],
      contextWindowTokens: 200_000,
    });
    expect(filePath).toHaveLength(150);
    expect(out).toContain(filePath);
    expect(out).toContain(outcome);
    expect(out).not.toContain('[earlier turns omitted]');
    expect(out).not.toContain('(truncated)');
  });

  it('does not stop at 24000 characters when the target window can hold more', () => {
    const body = 'FITTING-BODY-' + 'm'.repeat(30_000);
    const out = buildProviderSwitchCarry({
      messages: [{ id: 'u', role: 'user', content: body, timestamp: 1 }],
      contextWindowTokens: 20_000,
    });
    expect(out.length).toBeGreaterThan(24_000);
    expect(out).toContain('FITTING-BODY-');
    expect(out).not.toContain('[earlier turns omitted]');
  });

  it('respects a custom maxChars override and stays bounded', () => {
    const out = buildConversationContextBootstrap(
      [
        userMsg('a'.repeat(500)),
        assistantMsg('b'.repeat(500)),
        userMsg('c'.repeat(500)),
      ],
      { maxChars: 200 },
    );
    expect(out.length).toBeLessThanOrEqual(200);
    expect(out).toContain('[earlier turns omitted]');
  });

  it('preserves the conclusion of one oversized latest turn', () => {
    const out = buildConversationContextBootstrap([
      assistantMsg(`BEGIN-${'z'.repeat(500)}-FINAL-CONCLUSION`),
    ], { maxChars: 150 });

    expect(out).toContain('Assistant: BEGIN-');
    expect(out).toContain('FINAL-CONCLUSION');
    expect(out).toContain('[message middle omitted]');
  });

  it('returns empty string when maxChars is zero or negative', () => {
    const msgs = [userMsg('hi'), assistantMsg('yo')];
    expect(buildConversationContextBootstrap(msgs, { maxChars: 0 })).toBe('');
    expect(buildConversationContextBootstrap(msgs, { maxChars: -10 })).toBe('');
  });
});

describe('computeCondensedCarryCharBudget', () => {
  it('is a clearly smaller share of the window than a provider switch', () => {
    expect(CONDENSED_CARRY_WINDOW_SHARE).toBeGreaterThanOrEqual(0.15);
    expect(CONDENSED_CARRY_WINDOW_SHARE).toBeLessThanOrEqual(0.2);
    expect(computeCondensedCarryCharBudget(200_000))
      .toBe(Math.round(computeBootstrapCharCap(200_000) * CONDENSED_CARRY_WINDOW_SHARE));
    expect(computeCondensedCarryCharBudget(200_000)).toBeLessThan(computeBootstrapCharCap(200_000) / 4);
  });

  it('halves the unknown-window floor instead of inventing a window', () => {
    expect(computeCondensedCarryCharBudget(undefined)).toBe(CONTEXT_BOOTSTRAP_CHAR_CAP / 2);
    expect(computeCondensedCarryCharBudget(0)).toBe(CONTEXT_BOOTSTRAP_CHAR_CAP / 2);
  });
});

describe('buildCondensedContextCarry', () => {
  const longHistory = (): ChatMessage[] => Array.from({ length: 40 }, (_, index) => (
    index % 2 === 0
      ? userMsg(`frage-${index} ${'x'.repeat(400)}`, `u${index}`)
      : assistantMsg(`antwort-${index} ${'y'.repeat(400)}`, `a${index}`)
  ));

  it('returns an empty string when there is nothing to carry', () => {
    expect(buildCondensedContextCarry({ messages: [], contextWindowTokens: 10_000 })).toBe('');
  });

  it('keeps the newest turns inside the condensed budget and marks the cut', () => {
    // 2_000 tokens → 8_000 chars → condensed budget 1_440 chars.
    const carry = buildCondensedContextCarry({ messages: longHistory(), contextWindowTokens: 2_000 });
    expect(carry.length).toBeLessThanOrEqual(computeCondensedCarryCharBudget(2_000));
    expect(carry.startsWith('<conversation_context>\n')).toBe(true);
    expect(carry.endsWith('\n</conversation_context>')).toBe(true);
    expect(carry).toContain('antwort-39');
    expect(carry).not.toContain('frage-0 ');
    expect(carry).toContain('[earlier turns omitted]');
  });

  it('places the standing goal first so shrinking never drops it', () => {
    const carry = buildCondensedContextCarry({
      messages: longHistory(),
      contextWindowTokens: 2_000,
      goal: 'Release fertigstellen',
    });
    expect(carry.startsWith('<conversation_context>\n<standing_goal>\nRelease fertigstellen\n</standing_goal>')).toBe(true);
    expect(carry.length).toBeLessThanOrEqual(computeCondensedCarryCharBudget(2_000));
  });

  it('adds a model-written summary before the recent turns and keeps the whole within budget', () => {
    const carry = buildCondensedContextCarry({
      messages: longHistory(),
      contextWindowTokens: 4_000,
      goal: 'Ziel',
      summary: 'Wir haben das Build-Skript repariert und offen ist nur noch der Release.',
    });
    const goalAt = carry.indexOf('<standing_goal>');
    const summaryAt = carry.indexOf('<condensed_summary>');
    const turnsAt = carry.indexOf('antwort-39');
    expect(goalAt).toBeGreaterThan(-1);
    expect(summaryAt).toBeGreaterThan(goalAt);
    expect(turnsAt).toBeGreaterThan(summaryAt);
    expect(carry).toContain('Wir haben das Build-Skript repariert');
    expect(carry.length).toBeLessThanOrEqual(computeCondensedCarryCharBudget(4_000));
  });

  it('clips an oversized summary so recent turns still fit', () => {
    const carry = buildCondensedContextCarry({
      messages: longHistory(),
      contextWindowTokens: 4_000,
      summary: 's'.repeat(50_000),
    });
    expect(carry.length).toBeLessThanOrEqual(computeCondensedCarryCharBudget(4_000));
    expect(carry).toContain('antwort-39');
  });

  it('carries only the goal when the transcript has no renderable turns', () => {
    const carry = buildCondensedContextCarry({
      messages: [assistantMsg('')],
      contextWindowTokens: 4_000,
      goal: 'Nur das Ziel',
    });
    expect(carry).toBe('<conversation_context>\n<standing_goal>\nNur das Ziel\n</standing_goal>\n</conversation_context>');
  });
});

describe('condensedCarryOmitsTurns', () => {
  it('is false when the whole visible transcript fits the condensed budget', () => {
    expect(condensedCarryOmitsTurns([userMsg('kurz'), assistantMsg('auch kurz')], 200_000)).toBe(false);
  });

  it('is true when older turns would be dropped', () => {
    const messages = Array.from({ length: 30 }, (_, index) => userMsg('z'.repeat(500), `m${index}`));
    expect(condensedCarryOmitsTurns(messages, 2_000)).toBe(true);
  });
});
