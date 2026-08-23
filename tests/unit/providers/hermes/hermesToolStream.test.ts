import type { StreamChunk } from '@/core/types';
import { type AcpSessionUpdate, AcpSessionUpdateNormalizer } from '@/providers/acp';
import {
  createHermesToolStreamAdapter,
  deriveHermesToolInputFromTitle,
  enrichHermesToolCall,
} from '@/providers/hermes/normalization/hermesToolNormalization';

/**
 * Replays `session/update` payloads captured verbatim from a real
 * `hermes acp` turn, so the whole chain (normalizer → title decoding →
 * tool-stream adapter) is checked against the actual wire shape.
 */
const CAPTURED_UPDATES: AcpSessionUpdate[] = [
  {
    content: [{ content: { text: '$ echo HERMES_TOOL_PROBE', type: 'text' }, type: 'content' }],
    kind: 'execute',
    locations: [],
    sessionUpdate: 'tool_call',
    title: 'terminal: echo HERMES_TOOL_PROBE',
    toolCallId: 'tc-5cc8ad12958a',
  },
  {
    kind: 'read',
    locations: [{ path: 'package.json' }],
    sessionUpdate: 'tool_call',
    title: 'read: package.json',
    toolCallId: 'tc-14bef3e5d9a8',
  },
  {
    content: [{
      content: {
        text: 'terminal result\n- **output:** HERMES_TOOL_PROBE\n- **exit_code:** 0',
        type: 'text',
      },
      type: 'content',
    }],
    kind: 'execute',
    sessionUpdate: 'tool_call_update',
    status: 'completed',
    toolCallId: 'tc-5cc8ad12958a',
  },
] as AcpSessionUpdate[];

function replay(updates: AcpSessionUpdate[]): StreamChunk[] {
  const normalizer = new AcpSessionUpdateNormalizer();
  const adapter = createHermesToolStreamAdapter();
  const chunks: StreamChunk[] = [];

  for (const update of updates) {
    const normalized = normalizer.normalize(update);
    if (normalized.type === 'tool_call') {
      chunks.push(...adapter.normalizeToolCall(
        enrichHermesToolCall(normalized.toolCall),
        normalized.streamChunks,
      ));
    } else if (normalized.type === 'tool_call_update') {
      chunks.push(...adapter.normalizeToolCallUpdate(
        normalized.toolCallUpdate,
        normalized.streamChunks,
      ));
    }
  }

  return chunks;
}

describe('replaying a captured Hermes tool turn', () => {
  it('names both tool calls and recovers their arguments from the titles', () => {
    const toolUses = replay(CAPTURED_UPDATES).filter((chunk) => chunk.type === 'tool_use');

    expect(toolUses).toEqual([
      {
        id: 'tc-5cc8ad12958a',
        input: { command: 'echo HERMES_TOOL_PROBE' },
        name: 'Bash',
        type: 'tool_use',
      },
      {
        id: 'tc-14bef3e5d9a8',
        input: { file_path: 'package.json' },
        name: 'Read',
        type: 'tool_use',
      },
    ]);
  });

  it('emits exactly one tool_use per call, even with a completion update', () => {
    const chunks = replay(CAPTURED_UPDATES);

    expect(chunks.filter((chunk) => chunk.type === 'tool_use')).toHaveLength(2);
    expect(chunks.filter((chunk) => chunk.type === 'tool_result')).toHaveLength(1);
  });

  it('carries the completed terminal output into the tool result', () => {
    const result = replay(CAPTURED_UPDATES).find((chunk) => chunk.type === 'tool_result');

    expect(result).toMatchObject({ id: 'tc-5cc8ad12958a', isError: false });
    expect((result as { content: string }).content).toContain('HERMES_TOOL_PROBE');
  });

  it('marks a failed tool call as an error result', () => {
    const chunks = replay([
      CAPTURED_UPDATES[0],
      {
        content: [{ content: { text: 'command not found', type: 'text' }, type: 'content' }],
        kind: 'execute',
        sessionUpdate: 'tool_call_update',
        status: 'failed',
        toolCallId: 'tc-5cc8ad12958a',
      },
    ] as AcpSessionUpdate[]);

    expect(chunks.find((chunk) => chunk.type === 'tool_result')).toMatchObject({ isError: true });
  });
});

describe('deriveHermesToolInputFromTitle', () => {
  it.each([
    ['terminal', 'terminal: echo hi', { command: 'echo hi' }],
    ['read_file', 'read: package.json', { path: 'package.json' }],
    ['write_file', 'write: notes/a.md', { path: 'notes/a.md' }],
    ['patch', 'patch (replace): src/main.ts', { mode: 'replace', path: 'src/main.ts' }],
    ['search_files', 'search: TODO', { pattern: 'TODO' }],
    ['web_search', 'web search: hermes agent', { query: 'hermes agent' }],
    ['web_extract', 'extract: https://example.com', { url: 'https://example.com' }],
    ['browser_navigate', 'navigate: https://example.com', { url: 'https://example.com' }],
    ['execute_code', 'python: print(1)', { command: 'print(1)' }],
    ['delegate_task', 'delegate: refactor the parser', { goal: 'refactor the parser' }],
    ['session_search', 'session search: hermes', { query: 'hermes' }],
    ['memory', 'memory store: preferences', { action: 'store', target: 'preferences' }],
    ['process', 'process kill: abc123', { action: 'kill', session_id: 'abc123' }],
    ['cronjob', 'cron add: daily-report', { action: 'add', job_id: 'daily-report' }],
    ['skill_view', 'skill view (github-auth)', { name: 'github-auth' }],
    ['skill_manage', 'skill create: my-skill', { action: 'create', name: 'my-skill' }],
    ['vision_analyze', 'analyze image: what is this', { question: 'what is this' }],
    ['image_generate', 'generate image: a cat', { prompt: 'a cat' }],
  ])('decodes %s arguments from %s', (rawName, title, expected) => {
    expect(deriveHermesToolInputFromTitle(rawName, title)).toEqual(expected);
  });

  it('returns nothing for a title that carries no arguments', () => {
    expect(deriveHermesToolInputFromTitle('browser_snapshot', 'browser snapshot')).toEqual({});
    expect(deriveHermesToolInputFromTitle('terminal', null)).toEqual({});
    expect(deriveHermesToolInputFromTitle('kanban_create', 'kanban create: x')).toEqual({});
  });
});

describe('enrichHermesToolCall', () => {
  it('leaves a call that already carries rawInput untouched', () => {
    const toolCall = {
      kind: 'execute' as const,
      rawInput: { command: 'ls' },
      title: 'terminal: rm -rf /',
      toolCallId: 'tc-1',
    };

    expect(enrichHermesToolCall(toolCall)).toBe(toolCall);
  });

  it('leaves a call with an undecodable title untouched', () => {
    const toolCall = { kind: 'other' as const, title: 'browser snapshot', toolCallId: 'tc-1' };

    expect(enrichHermesToolCall(toolCall)).toBe(toolCall);
  });
});
