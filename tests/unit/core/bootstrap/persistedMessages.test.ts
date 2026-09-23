import {
  MAX_PERSISTED_SUBAGENT_TEXT_CHARS,
  MAX_PERSISTED_SUBAGENT_TIMELINE_ENTRIES,
  MAX_PERSISTED_SUBAGENT_TOOL_RESULT_CHARS,
  MAX_PERSISTED_SUBAGENT_TOOLS,
  MAX_PERSISTED_TOOL_RESULT_CHARS,
  MAX_PERSISTED_USER_TEXT_CHARS,
  toPersistedMessage,
  toPersistedMessages,
  toPersistedSubagent,
  TRUNCATION_NOTICE,
} from '@/core/bootstrap/persistedMessages';
import type { ChatMessage } from '@/core/types';

function messageWithToolResult(result: string): ChatMessage {
  return {
    id: 'msg-1',
    role: 'assistant',
    content: 'ok',
    timestamp: 0,
    toolCalls: [{ id: 'tool-1', name: 'Read', input: {}, status: 'completed', result }],
  } as ChatMessage;
}

describe('toPersistedMessage', () => {
  it('caps a tool result that would bloat the session file', () => {
    // Measured from a real vault: one `Read` persisted 540 KB, one assistant
    // message held 62 such calls, and the conversation file reached 17 MB.
    const huge = 'x'.repeat(540_000);

    const persisted = toPersistedMessage(messageWithToolResult(huge));
    const result = persisted.toolCalls?.[0]?.result ?? '';

    expect(result.length).toBe(MAX_PERSISTED_TOOL_RESULT_CHARS + TRUNCATION_NOTICE.length);
    expect(result.endsWith(TRUNCATION_NOTICE)).toBe(true);
  });

  it('leaves a result that already fits completely alone', () => {
    const small = 'kurze Ausgabe';

    const persisted = toPersistedMessage(messageWithToolResult(small));

    expect(persisted.toolCalls?.[0]?.result).toBe(small);
  });

  it('does not mutate the in-memory message', () => {
    // The running session must keep the full output on screen — only the copy
    // written to disk is shortened.
    const huge = 'y'.repeat(50_000);
    const message = messageWithToolResult(huge);

    toPersistedMessage(message);

    expect(message.toolCalls?.[0]?.result).toHaveLength(50_000);
  });

  it('still strips inlined image data', () => {
    const message = {
      id: 'msg-2',
      role: 'user',
      content: 'schau dir das an',
      timestamp: 0,
      images: [{ name: 'shot.png', mimeType: 'image/png', data: 'AAAABBBB' }],
    } as unknown as ChatMessage;

    const persisted = toPersistedMessage(message);

    expect(persisted.images?.[0]?.data).toBe('');
    expect(persisted.images?.[0]?.name).toBe('shot.png');
  });

  it('leaves messages without tool calls or images untouched', () => {
    const message = { id: 'm', role: 'user', content: 'hallo', timestamp: 0 } as ChatMessage;

    expect(toPersistedMessages([message])).toEqual([message]);
  });

  it('preserves the turn and semantic-block output surfaces for reload rendering', () => {
    const message = {
      id: 'rich-output',
      role: 'assistant',
      content: '```claudian-document\n# Plan\n```',
      timestamp: 0,
      outputSurface: 'live-document',
      contentBlocks: [{
        type: 'text',
        content: '```claudian-document\n# Plan\n```',
        outputSurface: 'live-document',
      }],
    } as ChatMessage;

    expect(toPersistedMessage(message)).toEqual(message);
  });

  it('shrinks a realistic transcript by more than an order of magnitude', () => {
    const messages = Array.from({ length: 10 }, (_, index) => ({
      id: `m-${index}`,
      role: 'assistant',
      content: 'Antwort',
      timestamp: 0,
      toolCalls: Array.from({ length: 6 }, (_, toolIndex) => ({
        id: `t-${index}-${toolIndex}`,
        name: 'Read',
        input: {},
        status: 'completed',
        result: 'z'.repeat(300_000),
      })),
    })) as unknown as ChatMessage[];

    const before = JSON.stringify(messages).length;
    const after = JSON.stringify(toPersistedMessages(messages)).length;

    expect(after).toBeLessThan(before / 20);
  });
});

describe('toPersistedSubagent', () => {
  it('keeps the live facts the inspector shows after a restart', () => {
    const persisted = toPersistedSubagent({
      id: 'toolu_1',
      description: 'Firewall prüfen',
      status: 'error',
      toolCalls: [],
      isExpanded: false,
      agentType: 'Explore',
      model: 'claude-haiku-4-5',
      providerId: 'claude',
      cancelState: 'cancelled',
      totalTokens: 15853,
      timeline: [{ type: 'text', text: 'Ich prüfe die Regeln.', at: 1 }],
    });

    expect(persisted).toMatchObject({
      agentType: 'Explore',
      model: 'claude-haiku-4-5',
      providerId: 'claude',
      cancelState: 'cancelled',
      totalTokens: 15853,
      timeline: [{ type: 'text', text: 'Ich prüfe die Regeln.', at: 1 }],
    });
  });

  // The session file is read on every start; a chatty subagent must not bloat it.
  it('bounds the persisted transcript and keeps its newest part', () => {
    const timeline = Array.from({ length: 300 }, (_, index) => (
      index % 2 === 0
        ? { type: 'text' as const, text: `${index}:${'x'.repeat(5_000)}`, at: index }
        : { type: 'tool' as const, toolId: `t${index}`, at: index }
    ));

    const persisted = toPersistedSubagent({
      id: 'toolu_1', description: 'Viel Text', status: 'completed', toolCalls: [], isExpanded: false, timeline,
    });

    const kept = persisted.timeline ?? [];
    expect(kept.length).toBeLessThanOrEqual(MAX_PERSISTED_SUBAGENT_TIMELINE_ENTRIES);
    expect(kept.at(-1)).toEqual({ type: 'tool', toolId: 't299', at: 299 });
    const textChars = kept.reduce((sum, entry) => sum + (entry.type === 'text' ? entry.text.length : 0), 0);
    expect(textChars).toBeLessThanOrEqual(MAX_PERSISTED_SUBAGENT_TEXT_CHARS);
  });
});

// A pasted table stored twice (content and displayContent) made one session
// file 10 MB; every tab load parsed it. The provider's own session keeps the
// full prompt, so Claudian's copy only needs what the transcript shows.
describe('toPersistedMessage — user text', () => {
  const user = (content: string, displayContent?: string): ChatMessage => ({
    id: 'u1', role: 'user', content, timestamp: 1, ...(displayContent !== undefined ? { displayContent } : {}),
  });

  it('does not store the display text again when it equals the content', () => {
    expect(toPersistedMessage(user('Prüfe Regel 12', 'Prüfe Regel 12')).displayContent).toBeUndefined();
    expect(toPersistedMessage(user('<ctx>…</ctx>Prüfe Regel 12', 'Prüfe Regel 12')).displayContent).toBe('Prüfe Regel 12');
  });

  it('caps a huge paste and says so', () => {
    const paste = 'a,b,c\n'.repeat(40_000);
    const persisted = toPersistedMessage(user(paste, paste));

    expect(persisted.content.length).toBeLessThanOrEqual(MAX_PERSISTED_USER_TEXT_CHARS + TRUNCATION_NOTICE.length);
    expect(persisted.content.endsWith(TRUNCATION_NOTICE)).toBe(true);
  });

  it('leaves assistant answers whole', () => {
    const answer = 'x'.repeat(MAX_PERSISTED_USER_TEXT_CHARS * 2);
    const persisted = toPersistedMessage({ id: 'a1', role: 'assistant', content: answer, timestamp: 1 });

    expect(persisted.content).toBe(answer);
  });
});

describe('toPersistedSubagent — child tools', () => {
  it('keeps a short preview of each child tool and only the newest ones', () => {
    const toolCalls = Array.from({ length: MAX_PERSISTED_SUBAGENT_TOOLS + 10 }, (_, index) => ({
      id: `t${index}`, name: 'Read', input: {}, status: 'completed' as const, result: 'r'.repeat(8_000),
    }));

    const persisted = toPersistedSubagent({
      id: 's', description: 'x', status: 'completed', isExpanded: false, toolCalls,
    });

    expect(persisted.toolCalls).toHaveLength(MAX_PERSISTED_SUBAGENT_TOOLS);
    expect(persisted.toolCalls.at(-1)?.id).toBe(`t${MAX_PERSISTED_SUBAGENT_TOOLS + 9}`);
    expect(persisted.toolCalls[0].result!.length).toBeLessThanOrEqual(MAX_PERSISTED_SUBAGENT_TOOL_RESULT_CHARS + TRUNCATION_NOTICE.length);
  });
});
