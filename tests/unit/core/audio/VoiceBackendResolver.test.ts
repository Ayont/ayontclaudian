import { VoiceBackendResolver } from '@/core/audio/VoiceBackendResolver';
import type { VoiceTranscriber } from '@/core/audio/VoiceTranscriber';

function fakeTranscriber(id: string, available: boolean): VoiceTranscriber {
  return {
    id,
    displayName: id,
    isAvailable: async () => available,
    transcribe: async () => ({ ok: true, text: '' }),
  };
}

describe('VoiceBackendResolver', () => {
  it('picks the first available transcriber', async () => {
    const resolver = new VoiceBackendResolver(true, 'darwin', [
      () => fakeTranscriber('fast', false),
      () => fakeTranscriber('fallback', true),
    ]);
    const backend = await resolver.resolve();
    expect(backend?.id).toBe('fallback');
  });

  it('prefers the fast transcriber when available', async () => {
    const resolver = new VoiceBackendResolver(true, 'darwin', [
      () => fakeTranscriber('mlx-whisper', true),
      () => fakeTranscriber('whisper-cli', true),
    ]);
    const backend = await resolver.resolve();
    expect(backend?.id).toBe('mlx-whisper');
  });

  it('returns null when nothing is available', async () => {
    const resolver = new VoiceBackendResolver(true, 'darwin', [
      () => fakeTranscriber('mlx-whisper', false),
      () => fakeTranscriber('whisper-cli', false),
    ]);
    const backend = await resolver.resolve();
    expect(backend).toBeNull();
  });

  it('uses injected factories verbatim regardless of platform', async () => {
    const resolver = new VoiceBackendResolver(false, 'win32', [
      () => fakeTranscriber('custom', true),
    ]);
    const backend = await resolver.resolve();
    expect(backend?.id).toBe('custom');
  });
});
