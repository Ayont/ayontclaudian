import type { ChatMessage } from '@/core/types';
import { assistantMessageText, userMessageText } from '@/features/chat/utils/messageText';

function user(partial: Partial<ChatMessage>): ChatMessage {
  return { id: 'u1', role: 'user', content: '', timestamp: 1, ...partial };
}

describe('userMessageText', () => {
  it('prefers the typed display text over the transport prompt', () => {
    const message = user({
      content: 'Fasse zusammen\n\n<current_note>\nNotes/a.md\n</current_note>',
      displayContent: 'Fasse zusammen',
    });

    expect(userMessageText(message)).toBe('Fasse zusammen');
  });

  it('strips every internal envelope from a history-loaded prompt without display text', () => {
    const content = [
      '<standing_goal>\nShip the release\n</standing_goal>',
      '<vault_context>\nRelevant vault knowledge:\n- From [[a]]\n</vault_context>',
      '<conversation_context>\nearlier turns\n</conversation_context>',
      'Was steht in der Notiz?',
      '',
      '<current_note>\nNotes/a.md\n</current_note>',
      '',
      '<editor_selection path="Notes/a.md" lines="1-2">\nzwei Zeilen\n</editor_selection>',
    ].join('\n');

    const text = userMessageText(user({ content }));

    expect(text).toBe('Was steht in der Notiz?');
    expect(text).not.toMatch(/standing_goal|vault_context|conversation_context|current_note|editor_selection/);
  });

  it('keeps plain prompts untouched', () => {
    expect(userMessageText(user({ content: 'Hallo <b>Welt</b>' }))).toBe('Hallo <b>Welt</b>');
  });
});

describe('assistantMessageText', () => {
  it('returns the trimmed body when present', () => {
    expect(assistantMessageText({ content: '  Antwort  ', contentBlocks: [] })).toBe('Antwort');
  });

  it('falls back to the visible text blocks when the body is empty', () => {
    expect(assistantMessageText({
      content: '',
      contentBlocks: [
        { type: 'thinking', content: 'intern' },
        { type: 'text', content: 'Erster Teil' },
        { type: 'tool_use', toolId: 't1' },
        { type: 'text', content: ' Zweiter Teil ' },
      ],
    })).toBe('Erster Teil\n\nZweiter Teil');
  });

  it('returns an empty string for an answer without text', () => {
    expect(assistantMessageText({ content: '' })).toBe('');
  });
});
