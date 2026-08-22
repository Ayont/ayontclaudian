import type { ChatTurnRequest } from '@/core/runtime/types';
import type { ChatMessage } from '@/core/types';
import { buildDshPromptText } from '@/providers/dsh/runtime/buildDshPrompt';

function request(text: string, overrides: Record<string, unknown> = {}): ChatTurnRequest {
  return {
    text,
    currentNotePath: undefined,
    editorSelection: undefined,
    browserSelection: undefined,
    canvasSelection: undefined,
    ...overrides,
  } as ChatTurnRequest;
}

function message(role: 'user' | 'assistant', content: string): ChatMessage {
  return { id: role + '-' + content.length, role, content, timestamp: 0 } as ChatMessage;
}

describe('buildDshPromptText', () => {
  it('passes a plain prompt through unchanged without history', () => {
    expect(buildDshPromptText(request('Was ist geblieben?'), [])).toBe('Was ist geblieben?');
  });

  it('replays conversation history so stateless headless turns keep context', () => {
    const history = [message('user', 'Mein Name ist Ada.'), message('assistant', 'Gemerkt.')];
    const prompt = buildDshPromptText(request('Was ist geblieben?'), history);
    expect(prompt).toContain('Mein Name ist Ada.');
    expect(prompt).toContain('Gemerkt.');
    expect(prompt).toContain('Was ist geblieben?');
  });

  it('appends the current note reference when one is set', () => {
    const prompt = buildDshPromptText(request('check', { currentNotePath: 'Notes/todo.md' }), []);
    expect(prompt).toContain('todo.md');
  });
});
