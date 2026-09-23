import type { ChatMessage, Conversation } from '@/core/types/chat';
import { formatConversationMarkdown, safeExportFileName } from '@/features/chat/export/ConversationExporter';

function msg(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: overrides.id ?? 'm1',
    role: overrides.role ?? 'user',
    content: overrides.content ?? '',
    timestamp: overrides.timestamp ?? 1_700_000_000_000,
    ...overrides,
  };
}

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conv-1',
    providerId: 'claude',
    title: 'My chat',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_500_000,
    sessionId: null,
    messages: [],
    ...overrides,
  } as Conversation;
}

const displayName = (id: string) => (id === 'claude' ? 'Claude' : id);

describe('formatConversationMarkdown', () => {
  it('writes provider-provenance front-matter', () => {
    const md = formatConversationMarkdown(
      conversation({
        messages: [
          msg({ id: 'u1', role: 'user', content: 'Hello' }),
          msg({ id: 'a1', role: 'assistant', content: 'Hi there', agentModel: 'sonnet-4.5', agentLabel: 'Claude · Sonnet 4.5' }),
        ],
      }),
      { providerDisplayName: displayName },
    );

    expect(md).toContain('source: claudian');
    expect(md).toContain('provider: "Claude"');
    expect(md).toContain('provider_id: "claude"');
    expect(md).toContain('models: ["sonnet-4.5"]');
    expect(md).toContain('message_count: 2');
    expect(md).toContain('# My chat');
  });

  it('labels turns: "## You" for user, agentLabel for assistant', () => {
    const md = formatConversationMarkdown(
      conversation({
        messages: [
          msg({ id: 'u1', role: 'user', content: 'Question?' }),
          msg({ id: 'a1', role: 'assistant', content: 'Answer.', agentLabel: 'Claude · Sonnet 4.5' }),
        ],
      }),
      { providerDisplayName: displayName },
    );

    expect(md).toContain('## You');
    expect(md).toContain('Question?');
    expect(md).toContain('## Claude · Sonnet 4.5');
    expect(md).toContain('Answer.');
  });

  it('summarizes tool calls but excludes thinking by default', () => {
    const md = formatConversationMarkdown(
      conversation({
        messages: [
          msg({
            id: 'a1',
            role: 'assistant',
            content: 'Done.',
            toolCalls: [{ id: 't1', name: 'Read' } as never, { id: 't2', name: 'Edit' } as never],
            contentBlocks: [{ type: 'thinking', content: 'secret reasoning' }],
          }),
        ],
      }),
      { providerDisplayName: displayName },
    );

    expect(md).toContain('Tools used (2)');
    expect(md).toContain('Read, Edit');
    expect(md).not.toContain('secret reasoning');
  });

  it('includes thinking when explicitly requested', () => {
    const md = formatConversationMarkdown(
      conversation({
        messages: [msg({ id: 'a1', role: 'assistant', content: 'Done.', contentBlocks: [{ type: 'thinking', content: 'my reasoning' }] })],
      }),
      { includeThinking: true, providerDisplayName: displayName },
    );
    expect(md).toContain('Reasoning');
    expect(md).toContain('my reasoning');
  });

  it('filters out rebuilt-context messages', () => {
    const md = formatConversationMarkdown(
      conversation({
        messages: [
          msg({ id: 'r1', role: 'user', content: 'INTERNAL REBUILD', isRebuiltContext: true }),
          msg({ id: 'u1', role: 'user', content: 'real message' }),
        ],
      }),
      { providerDisplayName: displayName },
    );
    expect(md).not.toContain('INTERNAL REBUILD');
    expect(md).toContain('real message');
    expect(md).toContain('message_count: 1');
  });

  it('handles an empty conversation gracefully', () => {
    const md = formatConversationMarkdown(conversation({ messages: [] }), { providerDisplayName: displayName });
    expect(md).toContain('message_count: 0');
    expect(md).toContain('no messages yet');
  });
});

describe('formatConversationMarkdown transport envelopes', () => {
  const transportPrompt = [
    '<standing_goal>\nShip it\n</standing_goal>',
    '<vault_context>\nRelevant vault knowledge:\n- From [[secret]]\n</vault_context>',
    '<conversation_context>\nolder turns\n</conversation_context>',
    'Was steht drin?',
    '',
    '<current_note>\nNotes/a.md\n</current_note>',
  ].join('\n');

  it('exports what the user typed, never the prompt envelopes', () => {
    const md = formatConversationMarkdown(conversation({
      messages: [
        msg({ id: 'u1', role: 'user', content: transportPrompt }),
        msg({ id: 'a1', role: 'assistant', content: 'Antwort' }),
      ],
    }));

    expect(md).toContain('Was steht drin?');
    expect(md).not.toMatch(/standing_goal|vault_context|conversation_context|current_note|secret/);
  });

  it('exports answers whose text only lives in content blocks', () => {
    const md = formatConversationMarkdown(conversation({
      messages: [
        msg({ id: 'u1', role: 'user', content: 'Frage' }),
        msg({ id: 'a1', role: 'assistant', content: '', contentBlocks: [{ type: 'text', content: 'Blocktext' }] }),
      ],
    }));

    expect(md).toContain('Blocktext');
  });

  it('leaves out a turn that a regenerated answer replaced', () => {
    const md = formatConversationMarkdown(conversation({
      messages: [
        msg({ id: 'u1', role: 'user', content: 'Frage' }),
        msg({ id: 'a1', role: 'assistant', content: 'Alte Antwort', isSuperseded: true }),
        msg({ id: 'u2', role: 'user', content: 'Frage' }),
        msg({ id: 'a2', role: 'assistant', content: 'Neue Antwort' }),
      ],
    }));

    expect(md).not.toContain('Alte Antwort');
    expect(md).toContain('Neue Antwort');
    expect(md).toContain('message_count: 2');
  });
});

describe('safeExportFileName', () => {
  it('strips path/illegal characters and trims', () => {
    expect(safeExportFileName('Re: a/b\\c:d*?"<>|')).not.toMatch(/[\\/:*?"<>|]/);
    expect(safeExportFileName('   ')).toBe('conversation');
    expect(safeExportFileName('Normal Title')).toBe('Normal Title');
  });
});
