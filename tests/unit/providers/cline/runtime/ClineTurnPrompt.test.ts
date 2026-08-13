import { buildConversationContextBootstrap } from '@/core/conversation/ConversationContextBootstrap';
import type { ChatMessage } from '@/core/types';
import {
  buildClineTurnPrompt,
  CLINE_CONTEXT_BOOTSTRAP_CHAR_CAP,
  stripClineConversationContext,
} from '@/providers/cline/runtime/ClineTurnPrompt';

function msg(role: 'user' | 'assistant', content: string, id: string): ChatMessage {
  return { id, role, content, timestamp: 1 };
}

describe('buildClineTurnPrompt', () => {
  const history = [
    msg('user', 'Wir bauen den Scheduler', 'u1'),
    msg('assistant', 'OK, ich plane die Jobs', 'a1'),
  ];

  it('injects prior turns when Cline has no native session', () => {
    const prompt = buildClineTurnPrompt({
      history,
      prompt: 'weiter',
      sessionId: null,
    });
    expect(prompt).toContain('<conversation_context>');
    expect(prompt).toContain('Wir bauen den Scheduler');
    expect(prompt.trim().endsWith('weiter')).toBe(true);
    expect(prompt.length).toBeLessThan(CLINE_CONTEXT_BOOTSTRAP_CHAR_CAP + 80);
  });

  it('does not inject when a native Cline session already carries history', () => {
    expect(buildClineTurnPrompt({
      history,
      prompt: 'weiter',
      sessionId: '1786522352621_1rqet',
    })).toBe('weiter');
  });

  it('rebuilds a larger snapshot instead of stacking a second context block', () => {
    const existing = buildConversationContextBootstrap(history, { maxChars: 40 });
    const prompt = buildClineTurnPrompt({
      history,
      prompt: `${existing}\n\nweiter`,
      sessionId: null,
    });
    expect(prompt.match(/<conversation_context>/g)).toHaveLength(1);
    expect(prompt).toContain('Wir bauen den Scheduler');
  });
});

describe('stripClineConversationContext', () => {
  it('removes a framed bootstrap so the user line stays', () => {
    expect(stripClineConversationContext(
      '<conversation_context>\nUser: a\n</conversation_context>\n\nweiter',
    )).toBe('weiter');
  });
});
