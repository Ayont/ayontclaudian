import type { StreamChunk } from '@/core/types';
import type ClaudianPlugin from '@/main';
import { KimiChatRuntime } from '@/providers/kimi/runtime/KimiChatRuntime';

function makePlugin(): ClaudianPlugin {
  return {
    app: {
      vault: {
        adapter: {
          basePath: '/tmp/vault',
        },
      },
    },
    settings: {
      providerConfigs: {
        kimi: {
          enabled: true,
          cliPath: '/bin/kimi',
        },
      },
    },
    getResolvedProviderCliPath: jest.fn().mockReturnValue('/bin/kimi'),
  } as unknown as ClaudianPlugin;
}

describe('KimiChatRuntime task tracking', () => {
  it('tracks Agent subagent tool_use as a task', () => {
    const runtime = new KimiChatRuntime(makePlugin());
    const chunk = (runtime as unknown as { trackToolCallAsTodo(c: StreamChunk): StreamChunk | null }).trackToolCallAsTodo({
      type: 'tool_use',
      id: 'call_agent_1',
      name: 'Agent',
      input: { description: 'Refactor module', prompt: 'Split the file' },
    });

    expect(chunk).not.toBeNull();
    expect(chunk?.type).toBe('tool_use');
    const toolUseChunk = chunk as Extract<StreamChunk, { type: 'tool_use' }>;
    expect(toolUseChunk.name).toBe('TodoWrite');
    expect((toolUseChunk.input as { todos: Array<{ content: string; status: string }> }).todos).toEqual([
      { content: 'Refactor module', status: 'in_progress', activeForm: 'Running task' },
    ]);
  });

  it('tracks legacy Task tool_use as a task', () => {
    const runtime = new KimiChatRuntime(makePlugin());
    const chunk = (runtime as unknown as { trackToolCallAsTodo(c: StreamChunk): StreamChunk | null }).trackToolCallAsTodo({
      type: 'tool_use',
      id: 'call_task_1',
      name: 'Task',
      input: { description: 'Long crawl', prompt: 'Index the repo' },
    });

    expect(chunk).not.toBeNull();
    const toolUseChunk = chunk as Extract<StreamChunk, { type: 'tool_use' }>;
    expect((toolUseChunk.input as { todos: Array<{ content: string; status: string }> }).todos[0].content).toBe('Long crawl');
  });

  it('does not track Bash/Read/Write tool_use as tasks', () => {
    const runtime = new KimiChatRuntime(makePlugin());
    for (const name of ['Bash', 'Read', 'Write', 'Edit', 'Glob']) {
      const chunk = (runtime as unknown as { trackToolCallAsTodo(c: StreamChunk): StreamChunk | null }).trackToolCallAsTodo({
        type: 'tool_use',
        id: `call_${name.toLowerCase()}_1`,
        name,
        input: { command: 'ls', file_path: 'foo.ts' },
      });
      expect(chunk).toBeNull();
    }
  });

  it('completes a tracked task on matching tool_result', () => {
    const runtime = new KimiChatRuntime(makePlugin());
    (runtime as unknown as { trackToolCallAsTodo(c: StreamChunk): StreamChunk | null }).trackToolCallAsTodo({
      type: 'tool_use',
      id: 'call_agent_1',
      name: 'Agent',
      input: { description: 'Refactor module', prompt: 'Split the file' },
    });

    const resultChunk = (runtime as unknown as { trackToolCallAsTodo(c: StreamChunk): StreamChunk | null }).trackToolCallAsTodo({
      type: 'tool_result',
      id: 'call_agent_1',
      content: 'Done',
      isError: false,
    });

    expect(resultChunk).not.toBeNull();
    const toolUseChunk = resultChunk as Extract<StreamChunk, { type: 'tool_use' }>;
    expect((toolUseChunk.input as { todos: Array<{ status: string }> }).todos[0].status).toBe('completed');
  });
});

describe('KimiChatRuntime slash command interception', () => {
  it('yields acknowledgement and done for /new without spawning', async () => {
    const plugin = makePlugin();
    const runtime = new KimiChatRuntime(plugin);
    runtime.syncConversationState({ sessionId: null, providerState: {} });

    const turn = {
      request: { text: '/new' },
      isCompact: false,
      mcpMentions: new Set<string>(),
      persistedContent: '',
      prompt: '/new',
    };

    const chunks: Array<{ type: string; content?: string }> = [];
    for await (const chunk of runtime.query(turn as unknown as Parameters<KimiChatRuntime['query']>[0])) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      { type: 'text', content: 'Starting a new Kimi session.' },
      { type: 'done' },
    ]);
  });

  it('passes through /compact to CLI spawn path', async () => {
    const plugin = makePlugin();
    const runtime = new KimiChatRuntime(plugin);
    runtime.syncConversationState({ sessionId: null, providerState: {} });

    const turn = {
      request: { text: '/compact' },
      isCompact: false,
      mcpMentions: new Set<string>(),
      persistedContent: '',
      prompt: '/compact',
    };

    const generator = runtime.query(turn as unknown as Parameters<KimiChatRuntime['query']>[0]);
    const first = await generator.next();
    // It should enter the spawn path and yield user_message_start first, not text/done.
    expect(first.value?.type).toBe('user_message_start');
    // Cancel to avoid hanging on spawn.
    runtime.cancel();
    await generator.return?.(undefined);
  });
});
