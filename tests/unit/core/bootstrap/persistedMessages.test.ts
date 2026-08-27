import {
  MAX_PERSISTED_TOOL_RESULT_CHARS,
  toPersistedMessage,
  toPersistedMessages,
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
