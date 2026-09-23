import type { ChatMessage } from '@/core/types';
import {
  carrySupersededMarks,
  withoutSupersededTurns,
} from '@/features/chat/utils/supersededTurns';

function msg(id: string, role: ChatMessage['role'], content: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return { id, role, content, timestamp: 1, ...extra };
}

describe('withoutSupersededTurns', () => {
  it('drops a turn whose every answer was replaced, prompt included', () => {
    const messages = [
      msg('u1', 'user', 'Frage'),
      msg('a1', 'assistant', 'Alt', { isSuperseded: true }),
      msg('u2', 'user', 'Frage'),
      msg('a2', 'assistant', 'Neu'),
    ];

    expect(withoutSupersededTurns(messages).map((m) => m.id)).toEqual(['u2', 'a2']);
  });

  it('keeps a turn that still has a current answer', () => {
    const messages = [
      msg('u1', 'user', 'Frage'),
      msg('a1', 'assistant', 'Teil', { isSuperseded: true }),
      msg('a2', 'assistant', 'Aktuell'),
    ];

    expect(withoutSupersededTurns(messages).map((m) => m.id)).toEqual(['u1', 'a2']);
  });

  it('treats interrupt markers as part of the turn, not as a new prompt', () => {
    const messages = [
      msg('u1', 'user', 'Frage'),
      msg('i1', 'user', '[Request interrupted by user]', { isInterrupt: true }),
      msg('a1', 'assistant', 'Alt', { isSuperseded: true }),
      msg('u2', 'user', 'Frage'),
      msg('a2', 'assistant', 'Neu'),
    ];

    expect(withoutSupersededTurns(messages).map((m) => m.id)).toEqual(['u2', 'a2']);
  });
});

describe('carrySupersededMarks', () => {
  it('re-applies marks to the hydrated transcript turn by turn', () => {
    const cached = [
      msg('u1', 'user', 'Frage', { displayContent: 'Frage' }),
      msg('a1', 'assistant', 'Alt', { isSuperseded: true }),
      msg('u2', 'user', 'Frage', { displayContent: 'Frage' }),
      msg('a2', 'assistant', 'Neu'),
    ];
    const hydrated = [
      msg('h1', 'user', 'Frage\n\n<current_note>\nx.md\n</current_note>'),
      msg('h2', 'assistant', 'Alt'),
      msg('h3', 'user', 'Frage'),
      msg('h4', 'assistant', 'Neu'),
    ];

    const result = carrySupersededMarks(cached, hydrated);

    expect(result.map((m) => m.isSuperseded === true)).toEqual([false, true, false, false]);
    expect(hydrated[1].isSuperseded).toBeUndefined();
  });

  it('leaves the transcript alone when the turns no longer line up', () => {
    const cached = [
      msg('u1', 'user', 'Frage'),
      msg('a1', 'assistant', 'Alt', { isSuperseded: true }),
    ];
    const hydrated = [
      msg('h1', 'user', 'Etwas anderes'),
      msg('h2', 'assistant', 'Antwort'),
    ];

    expect(carrySupersededMarks(cached, hydrated)).toBe(hydrated);
  });

  it('returns the hydrated list unchanged when nothing was superseded', () => {
    const hydrated = [msg('h1', 'user', 'Frage'), msg('h2', 'assistant', 'Antwort')];

    expect(carrySupersededMarks([msg('u1', 'user', 'Frage')], hydrated)).toBe(hydrated);
  });
});
