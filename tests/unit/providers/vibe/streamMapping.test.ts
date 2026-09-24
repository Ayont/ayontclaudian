import { parseVibeStreamLine } from '@/providers/vibe/normalization/streamEvents';
import { createVibeStreamState, mapVibeEventToChunks } from '@/providers/vibe/normalization/streamMapping';

const base = { sessionId: 's-1', turnId: 't', createdAt: 1, updatedAt: 1, generationStatus: 'completed', relatedEntryId: null };
const line = (entry: Record<string, unknown>) => parseVibeStreamLine(JSON.stringify({ ...base, ...entry }))!;

describe('mapVibeEventToChunks (vibe 2.25.8)', () => {
  it('shows a finished effect as one tool call with its result', () => {
    const state = createVibeStreamState();
    const effect = line({
      id: 'call_1',
      type: 'effect',
      title: 'Run',
      detail: { kind: 'shell', toolName: 'bash', display: { summary: 'ls' }, input: { command: 'ls' } },
      state: { status: 'completed', outputText: 'a.md', durationMs: 1, display: {} },
    });

    expect(mapVibeEventToChunks(effect, state)).toEqual([
      { type: 'tool_use', id: 'call_1', name: 'Bash', input: { command: 'ls' } },
      { type: 'tool_result', id: 'call_1', content: 'a.md', isError: false },
    ]);
    expect(mapVibeEventToChunks(effect, state)).toEqual([]);
  });

  it('shows reasoning as thinking', () => {
    expect(mapVibeEventToChunks(line({ id: 'r', type: 'reasoning', text: 'Plan', summary: [] }), createVibeStreamState()))
      .toEqual([{ type: 'thinking', content: 'Plan' }]);
  });

  it('marks a finished compaction as a boundary', () => {
    const checkpoint = line({ id: 'cp', type: 'checkpoint', kind: 'compaction', message: 'Context compacted', details: { newSessionId: 's-2' } });

    expect(mapVibeEventToChunks(checkpoint, createVibeStreamState())).toEqual([{ type: 'context_compacted' }]);
  });

  it('keeps user echoes and notices out of the answer', () => {
    const state = createVibeStreamState();
    expect(mapVibeEventToChunks(line({ id: 'u', type: 'message', role: 'user', content: [{ type: 'text', text: 'hi' }] }), state)).toEqual([]);
    expect(mapVibeEventToChunks(line({ id: 'n', type: 'notice', level: 'info', message: 'x', detail: { kind: 'agent_changed', agentName: 'plan' } }), state)).toEqual([]);
  });
});
