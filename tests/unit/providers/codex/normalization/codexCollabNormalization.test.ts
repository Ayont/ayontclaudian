import {
  buildCodexCollabToolInput,
  buildCodexCollabToolResult,
  buildCodexSubAgentActivityToolCall,
  extractCodexAgentStates,
  isCodexCollabToolCallError,
  isOpaqueCodexPayload,
  normalizeCodexCollabToolName,
  readCodexAgentStates,
  readReadableCodexText,
  toCodexTaskLabel,
} from '@/providers/codex/normalization/codexCollabNormalization';
import type { CollabAgentToolCallItem } from '@/providers/codex/runtime/codexAppServerTypes';

const FERNET_TOKEN = 'gAAAAABqmZ_tUVznNXRzJuF0ObJbwrreO4evv11WddBIa1phae3r1oFksM-aVYRqAUPsuUjuT07P_73OSNO1kGUAJhlffUhxGtMSXWE9';

function collabItem(overrides: Partial<CollabAgentToolCallItem> = {}): CollabAgentToolCallItem {
  return {
    type: 'collabAgentToolCall',
    id: 'call_spawn',
    tool: 'spawnAgent',
    status: 'completed',
    senderThreadId: 'thread-parent',
    receiverThreadIds: [],
    agentsStates: {},
    ...overrides,
  };
}

describe('codexCollabNormalization', () => {
  describe('normalizeCodexCollabToolName', () => {
    it.each([
      ['spawnAgent', 'spawn_agent'],
      ['sendInput', 'send_input'],
      ['resumeAgent', 'resume_agent'],
      ['wait', 'wait'],
      ['closeAgent', 'close_agent'],
      ['sendMessage', 'send_message'],
      ['followupTask', 'followup_task'],
      ['interruptAgent', 'interrupt_agent'],
      ['listAgents', 'list_agents'],
    ])('maps %s to %s', (tool, expected) => {
      expect(normalizeCodexCollabToolName(tool)).toBe(expected);
    });

    it('passes unknown tools through unchanged', () => {
      expect(normalizeCodexCollabToolName('futureTool')).toBe('futureTool');
    });
  });

  describe('opaque payload detection', () => {
    it('treats Fernet tokens as opaque', () => {
      expect(isOpaqueCodexPayload(FERNET_TOKEN)).toBe(true);
    });

    it('treats long whitespace-free base64 as opaque', () => {
      expect(isOpaqueCodexPayload('QUJD'.repeat(40))).toBe(true);
    });

    it('keeps normal prose readable', () => {
      expect(isOpaqueCodexPayload('Inspect utils.ts and patch the bug.')).toBe(false);
    });

    it('readReadableCodexText drops blanks, non-strings and opaque blobs', () => {
      expect(readReadableCodexText('  Do work  ')).toBe('Do work');
      expect(readReadableCodexText(FERNET_TOKEN)).toBe('');
      expect(readReadableCodexText('   ')).toBe('');
      expect(readReadableCodexText(42)).toBe('');
      expect(readReadableCodexText(null)).toBe('');
    });
  });

  describe('toCodexTaskLabel', () => {
    it('keeps plain task names', () => {
      expect(toCodexTaskLabel('shortcut_patterns')).toBe('shortcut_patterns');
    });

    it('uses the last segment of an agent path', () => {
      expect(toCodexTaskLabel('/root/writing_style')).toBe('writing_style');
    });

    it('returns empty for the root path and non-strings', () => {
      expect(toCodexTaskLabel('/root')).toBe('root');
      expect(toCodexTaskLabel('/')).toBe('');
      expect(toCodexTaskLabel(undefined)).toBe('');
    });
  });

  describe('readCodexAgentStates', () => {
    it('keeps known statuses and drops null messages', () => {
      expect(readCodexAgentStates({
        a: { status: 'completed', message: 'done' },
        b: { status: 'running', message: null },
      })).toEqual({
        a: { status: 'completed', message: 'done' },
        b: { status: 'running' },
      });
    });

    it('drops malformed entries and unknown statuses', () => {
      expect(readCodexAgentStates({
        a: 'completed',
        b: { status: 'teleported' },
        c: null,
      })).toEqual({});
      expect(readCodexAgentStates(undefined)).toEqual({});
      expect(readCodexAgentStates([])).toEqual({});
    });

    it('extractCodexAgentStates parses a tool result summary', () => {
      expect(extractCodexAgentStates('{"agents_states":{"t1":{"status":"errored","message":"boom"}}}'))
        .toEqual({ t1: { status: 'errored', message: 'boom' } });
      expect(extractCodexAgentStates('not json')).toEqual({});
      expect(extractCodexAgentStates(undefined)).toEqual({});
    });
  });

  describe('buildCodexCollabToolInput', () => {
    it('merges v2 fields into snake_case input', () => {
      expect(buildCodexCollabToolInput(collabItem({
        status: 'inProgress',
        prompt: 'Review the parser',
        model: 'gpt-6-sol',
        reasoningEffort: 'high',
      }))).toEqual({
        prompt: 'Review the parser',
        model: 'gpt-6-sol',
        reasoning_effort: 'high',
      });
    });

    it('keeps legacy arguments and adds receivers and states when present', () => {
      expect(buildCodexCollabToolInput(collabItem({
        tool: 'wait',
        arguments: { timeout_ms: 30_000 },
        receiverThreadIds: ['thread-child'],
        agentsStates: { 'thread-child': { status: 'running' } },
      }))).toEqual({
        timeout_ms: 30_000,
        receiver_thread_ids: ['thread-child'],
        agents_states: { 'thread-child': { status: 'running' } },
      });
    });

    it('omits an encrypted prompt', () => {
      expect(buildCodexCollabToolInput(collabItem({ prompt: FERNET_TOKEN }))).toEqual({});
    });

    it('tolerates pre-v2 items without the v2 fields', () => {
      const legacy = { type: 'collabAgentToolCall', id: 'x', tool: 'spawnAgent', status: 'inProgress' } as unknown as CollabAgentToolCallItem;
      expect(buildCodexCollabToolInput(legacy)).toEqual({});
    });
  });

  describe('buildCodexCollabToolResult', () => {
    it('reports the spawned child as agent_id with its state', () => {
      const content = buildCodexCollabToolResult(collabItem({
        receiverThreadIds: ['thread-child'],
        agentsStates: { 'thread-child': { status: 'pendingInit' } },
      }));

      expect(JSON.parse(content)).toEqual({
        agent_id: 'thread-child',
        receiver_thread_ids: ['thread-child'],
        agents_states: { 'thread-child': { status: 'pendingInit' } },
      });
    });

    it('summarises wait results without an agent_id', () => {
      const content = buildCodexCollabToolResult(collabItem({
        id: 'call_wait',
        tool: 'wait',
        receiverThreadIds: ['thread-child'],
        agentsStates: { 'thread-child': { status: 'completed', message: 'All tests pass.' } },
      }));

      expect(JSON.parse(content)).toEqual({
        receiver_thread_ids: ['thread-child'],
        agents_states: { 'thread-child': { status: 'completed', message: 'All tests pass.' } },
      });
    });

    it('prefers a legacy result object', () => {
      const legacy = collabItem({ result: { agent_id: 'agent-1', nickname: 'Zeno' } });
      expect(buildCodexCollabToolResult(legacy)).toBe('{"agent_id":"agent-1","nickname":"Zeno"}');
    });

    it('falls back to the call status when nothing else is known', () => {
      expect(buildCodexCollabToolResult(collabItem())).toBe('Completed');
      expect(buildCodexCollabToolResult(collabItem({ status: 'interrupted' }))).toBe('interrupted');
    });

    it('flags failed calls as errors', () => {
      expect(isCodexCollabToolCallError(collabItem({ status: 'failed' }))).toBe(true);
      expect(isCodexCollabToolCallError(collabItem({ status: 'completed' }))).toBe(false);
    });
  });

  describe('buildCodexSubAgentActivityToolCall', () => {
    it('links a completion to its spawn and carries the final text', () => {
      const call = buildCodexSubAgentActivityToolCall(
        { type: 'subAgentActivity', id: 'subagent-completed-1', kind: 'completed', agentThreadId: 'thread-child', agentPath: '/root/writing_style' },
        { spawnToolId: 'call_spawn', finalText: '  Final answer  ' },
      );

      expect(call.input).toEqual({
        targets: ['thread-child'],
        agent_path: '/root/writing_style',
        kind: 'completed',
        spawn_tool_id: 'call_spawn',
      });
      expect(JSON.parse(call.content)).toEqual({
        agents_states: { 'thread-child': { status: 'completed', message: 'Final answer' } },
      });
    });

    it('reports interruptions without inventing a message', () => {
      const call = buildCodexSubAgentActivityToolCall(
        { type: 'subAgentActivity', id: 'a-1', kind: 'interrupted', agentThreadId: 'thread-child', agentPath: '/root/x' },
        { finalText: 'partial' },
      );

      expect(call.input).not.toHaveProperty('spawn_tool_id');
      expect(JSON.parse(call.content)).toEqual({
        agents_states: { 'thread-child': { status: 'interrupted' } },
      });
    });
  });
});
