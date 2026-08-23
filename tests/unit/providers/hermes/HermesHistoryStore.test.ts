import { mapHermesMessages, stripVaultPrompt } from '@/providers/hermes/history/HermesHistoryStore';
import type { StoredRow } from '@/providers/hermes/history/HermesSqliteReader';

// Row shapes captured from a real `hermes acp` turn in ~/.hermes/state.db.
const TERMINAL_CALL_ID = 'f24532be-ae73-42a7-9705-b8b1b4b9437b';
const READ_CALL_ID = '9f96b2fb-9387-4e27-bebc-71a5a61c965f';

function toolCallsJson(): string {
  return JSON.stringify([
    {
      call_id: TERMINAL_CALL_ID,
      function: { arguments: JSON.stringify({ command: 'echo HERMES_TOOL_PROBE' }), name: 'terminal' },
      id: TERMINAL_CALL_ID,
      type: 'function',
    },
    {
      call_id: READ_CALL_ID,
      function: { arguments: JSON.stringify({ path: 'package.json' }), name: 'read_file' },
      id: READ_CALL_ID,
      type: 'function',
    },
  ]);
}

function transcriptRows(): StoredRow[] {
  return [
    {
      content: 'Run the shell command and read package.json.',
      id: 20,
      role: 'user',
      timestamp: 1787431921.1196449,
    },
    { content: '', id: 21, role: 'assistant', timestamp: 1787431923.2074869, tool_calls: toolCallsJson() },
    {
      content: '{"output": "HERMES_TOOL_PROBE", "exit_code": 0, "error": null}',
      id: 22,
      role: 'tool',
      timestamp: 1787431923.6505039,
      tool_call_id: TERMINAL_CALL_ID,
      tool_name: 'terminal',
    },
    {
      content: '{"content": "1|{\\n2|  \\"name\\": \\"claudian\\""}',
      id: 23,
      role: 'tool',
      timestamp: 1787431923.768215,
      tool_call_id: READ_CALL_ID,
      tool_name: 'read_file',
    },
    {
      content: 'Shell output: `HERMES_TOOL_PROBE` (exit 0).\n\nDONE',
      id: 24,
      role: 'assistant',
      timestamp: 1787431926.574646,
    },
  ];
}

describe('mapHermesMessages', () => {
  it('folds tool rows back into the assistant turn that requested them', () => {
    const messages = mapHermesMessages(transcriptRows());

    expect(messages.map((message) => message.role)).toEqual(['user', 'assistant']);
    const assistant = messages[1];
    expect(assistant.content).toBe('Shell output: `HERMES_TOOL_PROBE` (exit 0).\n\nDONE');
    expect(assistant.toolCalls?.map((call) => [call.name, call.status])).toEqual([
      ['Bash', 'completed'],
      ['Read', 'completed'],
    ]);
    expect(assistant.toolCalls?.[0].input).toEqual({ command: 'echo HERMES_TOOL_PROBE' });
    expect(assistant.toolCalls?.[1].input).toEqual({ file_path: 'package.json' });
  });

  it('converts Hermes\' fractional epoch seconds to milliseconds', () => {
    const messages = mapHermesMessages(transcriptRows());

    expect(messages[0].timestamp).toBe(1787431921120);
  });

  it('flags a structurally failed tool result as an error', () => {
    const messages = mapHermesMessages([
      { content: '', id: 1, role: 'assistant', timestamp: 1, tool_calls: toolCallsJson() },
      {
        content: '{"output": "", "exit_code": 127}',
        id: 2,
        role: 'tool',
        timestamp: 2,
        tool_call_id: TERMINAL_CALL_ID,
      },
    ]);

    expect(messages[0].toolCalls?.[0].status).toBe('error');
  });

  it('does not fail a tool that merely printed the word error', () => {
    const messages = mapHermesMessages([
      { content: '', id: 1, role: 'assistant', timestamp: 1, tool_calls: toolCallsJson() },
      {
        content: '{"output": "error: nothing to commit", "exit_code": 0, "error": null}',
        id: 2,
        role: 'tool',
        timestamp: 2,
        tool_call_id: TERMINAL_CALL_ID,
      },
    ]);

    expect(messages[0].toolCalls?.[0].status).toBe('completed');
  });

  it('marks a tool call without a stored result as still running', () => {
    const messages = mapHermesMessages([
      { content: '', id: 1, role: 'assistant', timestamp: 1, tool_calls: toolCallsJson() },
    ]);

    expect(messages[0].toolCalls?.map((call) => call.status)).toEqual(['running', 'running']);
  });

  it('renders reasoning as a thinking block', () => {
    const messages = mapHermesMessages([
      {
        content: 'Answer.',
        id: 1,
        reasoning_content: 'Let me think.',
        role: 'assistant',
        timestamp: 1,
      },
    ]);

    expect(messages[0].contentBlocks).toEqual([
      { content: 'Let me think.', type: 'thinking' },
      { content: 'Answer.', type: 'text' },
    ]);
  });

  it('skips system rows and empty turns', () => {
    expect(mapHermesMessages([
      { content: 'You are Hermes.', id: 1, role: 'system', timestamp: 1 },
      { content: '   ', id: 2, role: 'user', timestamp: 2 },
      { content: '', id: 3, role: 'assistant', timestamp: 3 },
    ])).toEqual([]);
  });

  it('hides the vault preamble from the replayed user message', () => {
    const messages = mapHermesMessages([
      {
        content: '<claudian-vault-instructions>\nVault rules\n</claudian-vault-instructions>\n\nHallo',
        id: 1,
        role: 'user',
        timestamp: 1,
      },
    ]);

    expect(messages[0].content).toBe('Hallo');
  });
});

describe('stripVaultPrompt', () => {
  it('removes only a leading preamble', () => {
    expect(stripVaultPrompt('<claudian-vault-instructions>\nx\n</claudian-vault-instructions>\n\nHi'))
      .toBe('Hi');
    expect(stripVaultPrompt('Hi <claudian-vault-instructions>x</claudian-vault-instructions>'))
      .toBe('Hi <claudian-vault-instructions>x</claudian-vault-instructions>');
  });
});
