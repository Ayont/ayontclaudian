import { parseVibeStreamLine } from '@/providers/vibe/normalization/streamEvents';

describe('parseVibeStreamLine (vibe --output streaming LLMMessage)', () => {
  it('parses an assistant message with string content', () => {
    const event = parseVibeStreamLine(JSON.stringify({ role: 'assistant', content: 'Hello there' }));
    expect(event).not.toBeNull();
    expect(event?.role).toBe('assistant');
    expect(event?.parts).toEqual([{ type: 'text', text: 'Hello there' }]);
    expect(event?.toolCalls).toEqual([]);
  });

  it('surfaces reasoning_content as a leading think part', () => {
    const event = parseVibeStreamLine(
      JSON.stringify({ role: 'assistant', reasoning_content: 'thinking…', content: 'answer' }),
    );
    expect(event?.parts).toEqual([
      { type: 'think', text: 'thinking…' },
      { type: 'text', text: 'answer' },
    ]);
  });

  it('parses tool_calls with nested function + JSON-string arguments', () => {
    const event = parseVibeStreamLine(
      JSON.stringify({
        role: 'assistant',
        content: '',
        tool_calls: [
          { id: 'call_1', function: { name: 'bash', arguments: '{"cmd":"ls"}' } },
        ],
      }),
    );
    expect(event?.toolCalls).toEqual([{ id: 'call_1', name: 'bash', input: { cmd: 'ls' } }]);
  });

  it('parses a tool result message with tool_call_id', () => {
    const event = parseVibeStreamLine(
      JSON.stringify({ role: 'tool', content: 'file1\nfile2', tool_call_id: 'call_1' }),
    );
    expect(event?.role).toBe('tool');
    expect(event?.toolCallId).toBe('call_1');
    expect(event?.parts).toEqual([{ type: 'text', text: 'file1\nfile2' }]);
  });

  it('returns null for blank or non-object or roleless lines', () => {
    expect(parseVibeStreamLine('')).toBeNull();
    expect(parseVibeStreamLine('not json')).toBeNull();
    expect(parseVibeStreamLine('[]')).toBeNull();
    expect(parseVibeStreamLine(JSON.stringify({ content: 'no role' }))).toBeNull();
  });
});

// vibe 2.25.8 `--output streaming` writes one PublicHistoryEntry per line
// (vibe/cli/programmatic.py → app_server/models.py), camelCase, tagged by `type`.
describe('parseVibeStreamLine (vibe 2.25.8 history entries)', () => {
  const base = {
    sessionId: '7d9fe80c-6e47-829c-68c2-2a48ddd7ca53',
    turnId: 'turn-1',
    createdAt: 1790261544548,
    updatedAt: 1790261544548,
    generationStatus: 'completed',
    relatedEntryId: null,
  };

  it('reads a message entry (captured from a real vibe 2.25.8 run)', () => {
    const line = '{"id": "137de6c6-6a03-4280-bc16-62f7f9ebfdba", "sessionId": "7d9fe80c-6e47-829c-68c2-2a48ddd7ca53", "turnId": "189f04ba-7896-4f21-88f8-81d7b5fcabb5", "createdAt": 1790261544548, "updatedAt": 1790261544548, "generationStatus": "completed", "relatedEntryId": null, "type": "message", "role": "user", "content": [{"type": "text", "text": "Antworte nur mit dem Wort OK."}], "source": "turn_start", "userDisplayContent": null}';

    const event = parseVibeStreamLine(line);

    expect(event).toMatchObject({
      role: 'user',
      entryType: 'message',
      sessionId: '7d9fe80c-6e47-829c-68c2-2a48ddd7ca53',
      createdAt: 1790261544548,
      parts: [{ type: 'text', text: 'Antworte nur mit dem Wort OK.' }],
    });
  });

  it('turns a reasoning entry into an assistant think part', () => {
    const event = parseVibeStreamLine(JSON.stringify({ ...base, id: 'r1', type: 'reasoning', text: 'Erst lesen.', summary: [] }));

    expect(event).toMatchObject({ role: 'assistant', parts: [{ type: 'think', text: 'Erst lesen.' }] });
  });

  it('turns a finished effect into a canonical tool call with its result', () => {
    const event = parseVibeStreamLine(JSON.stringify({
      ...base,
      id: 'call_7',
      type: 'effect',
      title: 'Read file',
      detail: { kind: 'file_read', toolName: 'read_file', display: { summary: 'notes.md' }, input: { filePath: 'notes.md', offset: null, limit: 2000 } },
      state: { status: 'completed', outputText: '# Notes', durationMs: 4, display: {} },
    }));

    expect(event?.toolCalls).toEqual([{ id: 'call_7', name: 'Read', input: { file_path: 'notes.md' } }]);
    expect(event?.toolResult).toEqual({ content: '# Notes', isError: false });
  });

  it('marks a failed effect as an error', () => {
    const event = parseVibeStreamLine(JSON.stringify({
      ...base,
      id: 'call_8',
      type: 'effect',
      title: 'Run',
      detail: { kind: 'shell', toolName: 'bash', display: { summary: 'ls' }, input: { command: 'ls /nope' } },
      state: { status: 'failed', error: { message: 'exit 2' }, outputText: '', durationMs: 3, display: {} },
    }));

    expect(event?.toolCalls).toEqual([{ id: 'call_8', name: 'Bash', input: { command: 'ls /nope' } }]);
    expect(event?.toolResult).toEqual({ content: 'exit 2', isError: true });
  });

  it('reads a finished compaction checkpoint and the session it moved to', () => {
    const event = parseVibeStreamLine(JSON.stringify({
      ...base,
      id: 'cp1',
      type: 'checkpoint',
      kind: 'compaction',
      message: 'Context compacted',
      details: { summaryLength: 1800, oldSessionId: base.sessionId, newSessionId: 'aa11bb22-0000-0000-0000-000000000000' },
    }));

    expect(event?.compaction).toEqual({ newSessionId: 'aa11bb22-0000-0000-0000-000000000000' });
  });

  it('ignores a model-change checkpoint', () => {
    const event = parseVibeStreamLine(JSON.stringify({ ...base, id: 'cp2', type: 'checkpoint', kind: 'model_change', message: 'x', details: null }));

    expect(event?.compaction).toBeUndefined();
  });
});
