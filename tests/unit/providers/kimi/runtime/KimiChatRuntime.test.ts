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
