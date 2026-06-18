import {
  humanizeKimiTool,
  isAssistantTextEvent,
  isThinkingEvent,
  isToolResultError,
  isToolResultEvent,
  isToolUseEvent,
  joinTextParts,
  joinThinkParts,
  parseKimiStream,
  parseKimiStreamLine,
  renderToolResult,
} from '@/providers/kimi/normalization/streamEvents';
import {
  createKimiStreamState,
  extractSessionId,
  mapKimiEventToChunks,
  streamToChatMessages,
} from '@/providers/kimi/normalization/streamMapping';

// --- Real captured kimi-cli v1.47 stream-json lines (from kimi-schema.md) ---

// Thinking + tool call on one assistant line (OpenAI function-call shape).
const ASSISTANT_THINK_TOOLCALL = JSON.stringify({
  role: 'assistant',
  content: [
    {
      type: 'think',
      think: 'User wants me to list files then say "done". I should use Shell.',
      encrypted: null,
    },
  ],
  tool_calls: [
    {
      type: 'function',
      id: 'tool_mx2QYPQVjDJ7dNK7bVkhtxc7',
      function: { name: 'Shell', arguments: '{"command": "ls -la", "timeout": 10}' },
    },
  ],
});

// Tool result correlated by tool_call_id, with a <system> status wrapper.
const TOOL_RESULT = JSON.stringify({
  role: 'tool',
  content: [
    { type: 'text', text: '<system>Command executed successfully.</system>' },
    { type: 'text', text: 'total 24\nalpha.txt\nbeta.txt\n' },
  ],
  tool_call_id: 'tool_mx2QYPQVjDJ7dNK7bVkhtxc7',
});

// Final assistant line: think + visible text.
const ASSISTANT_FINAL = JSON.stringify({
  role: 'assistant',
  content: [
    { type: 'think', think: 'I have the listing...' },
    { type: 'text', text: 'Files in the dir:\n\n- alpha.txt\n- beta.txt\n\ndone' },
  ],
});

// --no-thinking plain answer: content is a bare string.
const ASSISTANT_BARE_STRING = JSON.stringify({ role: 'assistant', content: 'hi' });

// Tool result reporting a failure inside the <system> wrapper.
const TOOL_RESULT_ERROR = JSON.stringify({
  role: 'tool',
  content: [{ type: 'text', text: '<system>Command failed: exit code 1.</system>' }],
  tool_call_id: 'tool_err1',
});

describe('kimi stream-json parser', () => {
  it('parses an assistant line with think + tool call', () => {
    const event = parseKimiStreamLine(ASSISTANT_THINK_TOOLCALL);
    expect(event).not.toBeNull();
    expect(event?.role).toBe('assistant');
    expect(joinThinkParts(event!.parts)).toContain('list files');
    expect(joinTextParts(event!.parts)).toBe('');
    expect(event?.toolCalls).toHaveLength(1);
    expect(event?.toolCalls[0]).toMatchObject({
      id: 'tool_mx2QYPQVjDJ7dNK7bVkhtxc7',
      name: 'Shell',
      input: { command: 'ls -la', timeout: 10 },
    });
  });

  it('parses a bare-string assistant line as one text part', () => {
    const event = parseKimiStreamLine(ASSISTANT_BARE_STRING)!;
    expect(event.role).toBe('assistant');
    expect(joinTextParts(event.parts)).toBe('hi');
    expect(event.toolCalls).toHaveLength(0);
  });

  it('parses a tool result line with tool_call_id', () => {
    const event = parseKimiStreamLine(TOOL_RESULT)!;
    expect(event.role).toBe('tool');
    expect(event.toolCallId).toBe('tool_mx2QYPQVjDJ7dNK7bVkhtxc7');
    expect(renderToolResult(event)).toBe('Command executed successfully.\ntotal 24\nalpha.txt\nbeta.txt');
  });

  it('returns null for blank, invalid, or role-less lines', () => {
    expect(parseKimiStreamLine('')).toBeNull();
    expect(parseKimiStreamLine('   ')).toBeNull();
    expect(parseKimiStreamLine('not json')).toBeNull();
    expect(parseKimiStreamLine('{"content":"x"}')).toBeNull();
  });

  it('parses a multi-line buffer in order, skipping bad lines', () => {
    const buffer = [ASSISTANT_THINK_TOOLCALL, 'garbage', TOOL_RESULT, ASSISTANT_FINAL, ''].join('\n');
    const events = parseKimiStream(buffer);
    expect(events.map((e) => e.role)).toEqual(['assistant', 'tool', 'assistant']);
  });

  it('classifies assistant text, thinking, tool-use, and tool-result events', () => {
    const toolCall = parseKimiStreamLine(ASSISTANT_THINK_TOOLCALL)!;
    const result = parseKimiStreamLine(TOOL_RESULT)!;
    const final = parseKimiStreamLine(ASSISTANT_FINAL)!;

    expect(isThinkingEvent(toolCall)).toBe(true);
    expect(isToolUseEvent(toolCall)).toBe(true);
    expect(isAssistantTextEvent(toolCall)).toBe(false);

    expect(isToolResultEvent(result)).toBe(true);
    expect(isToolResultError(result)).toBe(false);

    expect(isAssistantTextEvent(final)).toBe(true);
    expect(joinTextParts(final.parts)).toContain('done');
  });

  it('detects tool failures from the <system> wrapper', () => {
    const event = parseKimiStreamLine(TOOL_RESULT_ERROR)!;
    expect(isToolResultError(event)).toBe(true);
    expect(renderToolResult(event)).toBe('Command failed: exit code 1.');
  });

  it('maps tool names to canonical plugin names (for icons + summaries)', () => {
    expect(humanizeKimiTool('Shell')).toBe('Bash');
    expect(humanizeKimiTool('Read')).toBe('Read');
    expect(humanizeKimiTool('Glob')).toBe('Glob');
    expect(humanizeKimiTool('WebSearch')).toBe('WebSearch');
    // Unknown tools fall back to a humanized label.
    expect(humanizeKimiTool('CustomTool')).toBe('Custom tool');
  });

  it('normalizes "path" to "file_path" for file tools', () => {
    const readEvent = parseKimiStreamLine(JSON.stringify({
      role: 'assistant',
      tool_calls: [{ type: 'function', function: { name: 'Read', arguments: '{"path":"src/app.tsx"}' } }],
    }))!;
    expect(readEvent.toolCalls[0]?.input).toMatchObject({ file_path: 'src/app.tsx' });
    expect(readEvent.toolCalls[0]?.input).not.toHaveProperty('path');

    const writeEvent = parseKimiStreamLine(JSON.stringify({
      role: 'assistant',
      tool_calls: [{ type: 'function', function: { name: 'Write', arguments: '{"path":"src/main.ts","content":"x"}' } }],
    }))!;
    expect(writeEvent.toolCalls[0]?.input).toMatchObject({ file_path: 'src/main.ts', content: 'x' });

    const editEvent = parseKimiStreamLine(JSON.stringify({
      role: 'assistant',
      tool_calls: [{ type: 'function', function: { name: 'Edit', arguments: '{"path":"src/styles.css"}' } }],
    }))!;
    expect(editEvent.toolCalls[0]?.input).toMatchObject({ file_path: 'src/styles.css' });
  });

  it('keeps "path" for non-file tools like LS', () => {
    const lsEvent = parseKimiStreamLine(JSON.stringify({
      role: 'assistant',
      tool_calls: [{ type: 'function', function: { name: 'LS', arguments: '{"path":"src"}' } }],
    }))!;
    expect(lsEvent.toolCalls[0]?.input).toMatchObject({ path: 'src' });
    expect(lsEvent.toolCalls[0]?.input).not.toHaveProperty('file_path');
  });
});

describe('kimi stream mapping (live)', () => {
  it('maps think + tool call into thinking and tool_use chunks', () => {
    const state = createKimiStreamState();
    const event = parseKimiStreamLine(ASSISTANT_THINK_TOOLCALL)!;
    const chunks = mapKimiEventToChunks(event, state);
    expect(chunks).toEqual([
      { type: 'thinking', content: 'User wants me to list files then say "done". I should use Shell.' },
      {
        type: 'tool_use',
        id: 'tool_mx2QYPQVjDJ7dNK7bVkhtxc7',
        name: 'Bash',
        input: { command: 'ls -la', timeout: 10 },
      },
    ]);
  });

  it('maps a tool result into a tool_result chunk keyed by tool_call_id', () => {
    const state = createKimiStreamState();
    const event = parseKimiStreamLine(TOOL_RESULT)!;
    expect(mapKimiEventToChunks(event, state)).toEqual([
      {
        type: 'tool_result',
        id: 'tool_mx2QYPQVjDJ7dNK7bVkhtxc7',
        content: 'Command executed successfully.\ntotal 24\nalpha.txt\nbeta.txt',
        isError: false,
      },
    ]);
  });

  it('maps the final assistant line into thinking + text chunks', () => {
    const state = createKimiStreamState();
    const event = parseKimiStreamLine(ASSISTANT_FINAL)!;
    const chunks = mapKimiEventToChunks(event, state);
    expect(chunks).toEqual([
      { type: 'thinking', content: 'I have the listing...' },
      { type: 'text', content: 'Files in the dir:\n\n- alpha.txt\n- beta.txt\n\ndone' },
    ]);
  });

  it('de-dupes repeated text, thinking, tool_use, and tool_result emissions', () => {
    const state = createKimiStreamState();
    const assistant = parseKimiStreamLine(ASSISTANT_THINK_TOOLCALL)!;
    const result = parseKimiStreamLine(TOOL_RESULT)!;

    expect(mapKimiEventToChunks(assistant, state)).toHaveLength(2);
    // Re-processing the same assistant line yields nothing new.
    expect(mapKimiEventToChunks(assistant, state)).toEqual([]);

    expect(mapKimiEventToChunks(result, state)).toHaveLength(1);
    expect(mapKimiEventToChunks(result, state)).toEqual([]);
  });

  it('marks a failing tool result as an error chunk', () => {
    const state = createKimiStreamState();
    const event = parseKimiStreamLine(TOOL_RESULT_ERROR)!;
    expect(mapKimiEventToChunks(event, state)).toEqual([
      { type: 'tool_result', id: 'tool_err1', content: 'Command failed: exit code 1.', isError: true },
    ]);
  });

  it('extracts a session id when a line carries one', () => {
    const withSession = parseKimiStream(
      [JSON.stringify({ role: 'assistant', content: 'hi', session_id: 'sess_123' })].join('\n'),
    );
    expect(extractSessionId(withSession)).toBe('sess_123');
    expect(extractSessionId(parseKimiStream(ASSISTANT_BARE_STRING))).toBeNull();
  });
});

describe('kimi stream mapping (history)', () => {
  it('reconstructs assistant messages and completes tool calls by id', () => {
    const buffer = [ASSISTANT_THINK_TOOLCALL, TOOL_RESULT, ASSISTANT_FINAL].join('\n');
    const messages = streamToChatMessages(buffer);

    // The think-only assistant line carries a tool call, so it becomes a message.
    expect(messages).toHaveLength(2);

    const withTool = messages[0];
    expect(withTool.role).toBe('assistant');
    expect(withTool.toolCalls).toHaveLength(1);
    expect(withTool.toolCalls?.[0]).toMatchObject({
      id: 'tool_mx2QYPQVjDJ7dNK7bVkhtxc7',
      name: 'Bash',
      status: 'completed',
    });
    expect(withTool.toolCalls?.[0].result).toContain('alpha.txt');

    const final = messages[1];
    expect(final.role).toBe('assistant');
    expect(final.content).toContain('done');
  });

  it('drops think-only assistant lines with no text and no tool calls', () => {
    const thinkOnly = JSON.stringify({
      role: 'assistant',
      content: [{ type: 'think', think: 'just reasoning' }],
    });
    expect(streamToChatMessages(thinkOnly)).toHaveLength(0);
  });
});
