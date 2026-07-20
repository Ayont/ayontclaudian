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

  it('prefers the cloud backend when an API key is configured', async () => {
    // No factories → real candidate list; the cloud transcriber's availability
    // is config-only (key present), so it must win over every local backend
    // without any probing.
    const resolver = new VoiceBackendResolver(true, 'darwin', undefined, {
      baseUrl: 'https://api.groq.com/openai/v1',
      apiKey: 'gsk_test',
      model: 'whisper-large-v3-turbo',
    });
    const backend = await resolver.resolve();
    expect(backend?.id).toBe('cloud-whisper');
  });

  it('skips the cloud backend when factories are injected (test path)', async () => {
    const resolver = new VoiceBackendResolver(true, 'darwin', [
      () => fakeTranscriber('local', true),
    ], { baseUrl: 'https://api.groq.com/openai/v1', apiKey: 'gsk_test', model: 'whisper-large-v3-turbo' });
    const backend = await resolver.resolve();
    expect(backend?.id).toBe('local');
  });
});
