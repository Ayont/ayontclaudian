import { isOmpSessionHydrationDiagnosticMessage, mapOmpTranscript } from '@/providers/omp/history/OmpHistoryStore';

/**
 * Fixture lines are copied from a real `~/.omp/agent/sessions/**.jsonl` written
 * by omp v18.2.3 — not invented. Record shapes there decide whether replay
 * works, so a hand-written approximation would test nothing.
 */
const SESSION_HEADER = JSON.stringify({
  type: 'session',
  version: 3,
  id: '01a0adf5-cb37-7049-8f31-18a29172e7fb',
  timestamp: '2026-09-17T06:02:41.847Z',
  cwd: '/private/tmp',
});

const USER_MESSAGE = JSON.stringify({
  type: 'message',
  id: 'b768e0a9',
  parentId: '065bbad4',
  timestamp: '2026-09-17T06:17:36.909Z',
  message: {
    role: 'user',
    content: [{ type: 'text', text: 'hi' }],
    attribution: 'user',
    timestamp: 1789625856865,
  },
});

const ASSISTANT_MESSAGE = JSON.stringify({
  type: 'message',
  id: '79dc8180',
  parentId: 'b768e0a9',
  timestamp: '2026-09-17T06:17:43.660Z',
  message: {
    role: 'assistant',
    content: [{ type: 'text', text: '👋 Hi! What can I help you with?' }],
  },
});

describe('mapOmpTranscript', () => {
  it('maps user and assistant records to chat messages in transcript order', () => {
    const messages = mapOmpTranscript([SESSION_HEADER, USER_MESSAGE, ASSISTANT_MESSAGE].join('\n'));

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ role: 'user', content: 'hi' });
    expect(messages[1]).toMatchObject({
      role: 'assistant',
      content: '👋 Hi! What can I help you with?',
    });
    expect(messages[0].timestamp).toBe(Date.parse('2026-09-17T06:17:36.909Z'));
  });

  it('skips custom_message envelopes so injected goal context never replays as a user turn', () => {
    const goalEnvelope = JSON.stringify({
      type: 'custom_message',
      customType: 'goal-mode-context',
      content: '<goal_context>\nGoal mode active.\n</goal_context>',
      attribution: 'user',
      id: 'aa11',
      timestamp: '2026-09-17T06:17:30.000Z',
    });

    const messages = mapOmpTranscript([goalEnvelope, USER_MESSAGE].join('\n'));

    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('hi');
  });

  it('attaches tool results to the assistant tool call that produced them', () => {
    const assistantWithTool = JSON.stringify({
      type: 'message',
      id: 'cc33',
      timestamp: '2026-09-17T06:22:01.000Z',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Reading the file.' },
          {
            type: 'toolCall',
            toolCallId: 'af0092af|fc_tmp_m2dkf7u7h',
            toolName: 'read',
            input: { file_path: '/tmp/notes.md' },
          },
        ],
      },
    });
    const toolResult = JSON.stringify({
      type: 'message',
      id: 'dd44',
      timestamp: '2026-09-17T06:22:02.000Z',
      message: {
        role: 'toolResult',
        content: [{
          type: 'toolResult',
          toolCallId: 'af0092af|fc_tmp_m2dkf7u7h',
          result: '# Notes',
        }],
      },
    });

    const messages = mapOmpTranscript([assistantWithTool, toolResult].join('\n'));

    expect(messages).toHaveLength(1);
    expect(messages[0].toolCalls).toHaveLength(1);
    expect(messages[0].toolCalls?.[0]).toMatchObject({
      id: 'af0092af|fc_tmp_m2dkf7u7h',
      result: '# Notes',
      status: 'completed',
    });
  });

  it('marks a failed tool call as an error', () => {
    const assistantWithTool = JSON.stringify({
      type: 'message',
      id: 'ee55',
      message: {
        role: 'assistant',
        content: [{ type: 'toolCall', toolCallId: 't1', toolName: 'read', input: {} }],
      },
    });
    const toolResult = JSON.stringify({
      type: 'message',
      id: 'ff66',
      message: {
        role: 'toolResult',
        content: [{ type: 'toolResult', toolCallId: 't1', result: 'ENOENT', isError: true }],
      },
    });

    const messages = mapOmpTranscript([assistantWithTool, toolResult].join('\n'));

    expect(messages[0].toolCalls?.[0].status).toBe('error');
  });

  it('ignores malformed lines instead of losing the whole transcript', () => {
    const messages = mapOmpTranscript(['{not json', USER_MESSAGE, ''].join('\n'));

    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('hi');
  });

  it('reports a diagnostic when a non-empty transcript yields no messages', () => {
    const messages = mapOmpTranscript(SESSION_HEADER, 'session-123');

    expect(messages).toHaveLength(1);
    expect(isOmpSessionHydrationDiagnosticMessage(messages[0])).toBe(true);
  });

  it('returns nothing for an empty transcript', () => {
    expect(mapOmpTranscript('   ')).toEqual([]);
  });
});
