import type { StreamChunk } from '@/core/types';
import type ClaudianPlugin from '@/main';
import { ZcodeChatRuntime } from '@/providers/zcode/runtime/ZcodeChatRuntime';
import * as zcodeSettingsModule from '@/providers/zcode/settings';

describe('ZcodeChatRuntime', () => {
  let mockPlugin: ClaudianPlugin;
  let settingsBag: Record<string, unknown>;

  beforeEach(() => {
    settingsBag = {};
    mockPlugin = {
      settings: settingsBag,
    } as unknown as ClaudianPlugin;
  });

  it('yields error when provider is disabled', async () => {
    const runtime = new ZcodeChatRuntime(mockPlugin);
    const turn = runtime.prepareTurn({ text: 'Hello' });

    const chunks: StreamChunk[] = [];
    for await (const chunk of runtime.query(turn)) {
      chunks.push(chunk);
    }

    expect(chunks.some((c) => c.type === 'error' && c.content.includes('deaktiviert'))).toBe(true);
    expect(chunks[chunks.length - 1]).toEqual({ type: 'done' });
  });

  it('yields error when no API key is present and cannot be detected', async () => {
    const originalGet = zcodeSettingsModule.getZcodeProviderSettings;
    const getSpy = jest
      .spyOn(zcodeSettingsModule, 'getZcodeProviderSettings')
      .mockImplementation((settings) => {
        const res = originalGet(settings);
        return { ...res, enabled: true, apiKey: '' };
      });

    try {
      const runtime = new ZcodeChatRuntime(mockPlugin);
      const turn = runtime.prepareTurn({ text: 'Hello' });

      const chunks: StreamChunk[] = [];
      for await (const chunk of runtime.query(turn)) {
        chunks.push(chunk);
      }

      expect(chunks.some((c) => c.type === 'error' && c.content.includes('Kein Z.ai API-Key'))).toBe(true);
      expect(chunks[chunks.length - 1]).toEqual({ type: 'done' });
    } finally {
      getSpy.mockRestore();
    }
  });

  it('streams thinking deltas, text deltas and usage when API responds', async () => {
    zcodeSettingsModule.updateZcodeProviderSettings(settingsBag, (curr) => ({
      ...curr,
      enabled: true,
      apiKey: 'test-api-key',
    }));

    const runtime = new ZcodeChatRuntime(mockPlugin);
    const turn = runtime.prepareTurn({ text: 'Explain gravity' });

    const ssePayload = [
      'data: {"type":"message_start","message":{"usage":{"input_tokens":12}}}',
      '',
      'data: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"Let me think."}}',
      '',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Gravity is a force."}}',
      '',
      'data: {"type":"message_delta","usage":{"output_tokens":8}}',
      '',
      'data: [DONE]',
      '',
    ].join('\n');

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(ssePayload));
        controller.close();
      },
    });

    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: stream,
    });

    try {
      const chunks: StreamChunk[] = [];
      for await (const chunk of runtime.query(turn)) {
        chunks.push(chunk);
      }

      expect(chunks.some((c) => c.type === 'thinking' && c.content === 'Let me think.')).toBe(true);
      expect(chunks.some((c) => c.type === 'text' && c.content === 'Gravity is a force.')).toBe(true);
      expect(chunks.some((c) => c.type === 'usage')).toBe(true);
      expect(chunks[chunks.length - 1]).toEqual({ type: 'done' });
    } finally {
      global.fetch = originalFetch;
    }
  });
});
