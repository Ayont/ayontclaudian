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
