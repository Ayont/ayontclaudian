import { buildConversationContextBootstrap, buildProviderSwitchCarry } from '@/core/conversation/ConversationContextBootstrap';
import type { ChatMessage } from '@/core/types';
import {
  buildClineTurnPrompt,
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
  });

  it('keeps a fitting switch carry when the first Cline turn has no history', () => {
    const userConstraint = 'KEEP-THE-PORTAL-REVERSIBLE';
    const assistantDecision = 'MIGRATE-SHAREPOINT-FIRST';
    const filePath = `vault/${'p'.repeat(144)}`;
    const outcome = 'o'.repeat(2000);
    const goal = 'Portal migration stays reversible';
    const carry = buildProviderSwitchCarry({
      messages: [
        { id: 'u', role: 'user', content: userConstraint, timestamp: 1 },
        {
          id: 'a',
          role: 'assistant',
          content: assistantDecision,
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
      contextWindowTokens: 1_048_576,
      goal,
    });
    const prompt = buildClineTurnPrompt({
      history: [],
      prompt: `${carry}\n\ncontinue on Cline`,
      sessionId: null,
    });

    expect(filePath).toHaveLength(150);
    expect(prompt).toContain(userConstraint);
    expect(prompt).toContain(assistantDecision);
    expect(prompt).toContain(filePath);
    expect(prompt).toContain(outcome);
    expect(prompt).toContain(goal);
    expect(prompt).toContain('continue on Cline');
    expect(prompt).not.toContain('[earlier turns omitted]');
  });

  it('rebuilds more than 48000 characters when the Cline window can hold them', () => {
    const body = `CLINE-FITS-${'c'.repeat(50_000)}`;
    const prompt = buildClineTurnPrompt({
      history: [msg('user', body, 'u-long')],
      prompt: 'next',
      sessionId: null,
      contextWindowTokens: 262_144,
    });
    expect(prompt.length).toBeGreaterThan(48_000);
    expect(prompt).toContain(body);
    expect(prompt).not.toContain('[earlier turns omitted]');
    expect(prompt.trim().endsWith('next')).toBe(true);
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
