import type { WhisperServerManager } from '@/core/audio/WhisperServerManager';
import { WhisperServerTranscriber } from '@/core/audio/WhisperServerTranscriber';

function fakeManager(overrides: Partial<WhisperServerManager> = {}): WhisperServerManager {
  return {
    isAvailable: jest.fn().mockResolvedValue(true),
    transcribe: jest.fn().mockResolvedValue({ ok: true, text: 'Hallo' }),
    ...overrides,
  } as unknown as WhisperServerManager;
}

describe('WhisperServerTranscriber', () => {
  it('exposes a stable id and German display name', () => {
    const transcriber = new WhisperServerTranscriber(fakeManager());
    expect(transcriber.id).toBe('whisper-server');
    expect(transcriber.displayName).toContain('whisper-server');
  });

  it('delegates isAvailable to the manager', async () => {
    const manager = fakeManager({ isAvailable: jest.fn().mockResolvedValue(false) });
    const transcriber = new WhisperServerTranscriber(manager);
    expect(await transcriber.isAvailable()).toBe(false);
    expect(manager.isAvailable).toHaveBeenCalledTimes(1);
  });

  it('delegates transcribe to the manager with the same arguments', async () => {
    const manager = fakeManager();
    const transcriber = new WhisperServerTranscriber(manager);
    const controller = new AbortController();

    const result = await transcriber.transcribe('/tmp/a.wav', { language: 'de', model: 'base' }, controller.signal);

    expect(result).toEqual({ ok: true, text: 'Hallo' });
    expect(manager.transcribe).toHaveBeenCalledWith(
      '/tmp/a.wav',
      { language: 'de', model: 'base' },
      controller.signal,
    );
  });
});
