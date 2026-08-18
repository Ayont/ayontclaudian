import {
  GROQ_WHISPER_BASE_URL,
  GROQ_WHISPER_MODEL,
  MISTRAL_AUDIO_BASE_URL,
  MISTRAL_VOXTRAL_MODEL,
  resolveVoiceCloudConfig,
} from '@/core/audio/resolveVoiceCloudConfig';

describe('resolveVoiceCloudConfig', () => {
  it('prefers an explicit settings key over environment keys', () => {
    const config = resolveVoiceCloudConfig({
      cloudEnabled: true,
      cloudApiKey: 'gsk_settings',
      cloudBaseUrl: '',
      cloudModel: '',
      env: {
        GROQ_API_KEY: 'gsk_env',
        MISTRAL_API_KEY: 'msk_env',
      },
    });
    expect(config).toEqual({
      baseUrl: GROQ_WHISPER_BASE_URL,
      apiKey: 'gsk_settings',
      model: GROQ_WHISPER_MODEL,
    });
  });

  it('uses Groq from the environment when no settings key is set', () => {
    const config = resolveVoiceCloudConfig({
      cloudEnabled: false,
      cloudApiKey: '',
      env: { GROQ_API_KEY: 'gsk_env' },
    });
    expect(config).toEqual({
      baseUrl: GROQ_WHISPER_BASE_URL,
      apiKey: 'gsk_env',
      model: GROQ_WHISPER_MODEL,
    });
  });

  it('falls back to Mistral Voxtral from the Vibe/Mistral key', () => {
    const config = resolveVoiceCloudConfig({
      cloudEnabled: false,
      env: { MISTRAL_API_KEY: 'msk_vibe' },
    });
    expect(config).toEqual({
      baseUrl: MISTRAL_AUDIO_BASE_URL,
      apiKey: 'msk_vibe',
      model: MISTRAL_VOXTRAL_MODEL,
    });
  });

  it('prefers Groq over Mistral because the free turbo endpoint is faster', () => {
    const config = resolveVoiceCloudConfig({
      env: {
        GROQ_API_KEY: 'gsk_env',
        MISTRAL_API_KEY: 'msk_vibe',
      },
    });
    expect(config?.model).toBe(GROQ_WHISPER_MODEL);
    expect(config?.apiKey).toBe('gsk_env');
  });

  it('honors a custom settings endpoint when the user set one', () => {
    const config = resolveVoiceCloudConfig({
      cloudApiKey: 'sk-openai',
      cloudBaseUrl: 'https://api.openai.com/v1',
      cloudModel: 'gpt-4o-mini-transcribe',
    });
    expect(config).toEqual({
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-openai',
      model: 'gpt-4o-mini-transcribe',
    });
  });

  it('returns null when no key exists anywhere', () => {
    expect(resolveVoiceCloudConfig({ env: {} })).toBeNull();
  });
});
