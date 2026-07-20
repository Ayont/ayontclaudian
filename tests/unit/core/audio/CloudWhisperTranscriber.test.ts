import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';

import { type CloudWhisperConfig,CloudWhisperTranscriber } from '@/core/audio/CloudWhisperTranscriber';

const CONFIG: CloudWhisperConfig = {
  baseUrl: 'https://api.groq.com/openai/v1/',
  apiKey: 'gsk_test',
  model: 'whisper-large-v3-turbo',
};

function fakeResponse(init: {
  status: number;
  jsonBody?: unknown;
  textBody?: string;
}): Response {
  return {
    ok: init.status >= 200 && init.status < 300,
    status: init.status,
    json: async () => init.jsonBody,
    text: async () => init.textBody ?? '',
  } as unknown as Response;
}

describe('CloudWhisperTranscriber', () => {
  const wavPath = `${tmpdir()}/claudian-cloud-test.wav`;

  beforeAll(async () => {
    await fs.writeFile(wavPath, Buffer.from('RIFF-fake-wav'));
  });

  afterAll(async () => {
    await fs.rm(wavPath, { force: true });
  });

  it('isAvailable is false without an API key', async () => {
    const transcriber = new CloudWhisperTranscriber({ ...CONFIG, apiKey: '  ' });
    expect(await transcriber.isAvailable()).toBe(false);
  });

  it('isAvailable is true with an API key', async () => {
    const transcriber = new CloudWhisperTranscriber(CONFIG);
    expect(await transcriber.isAvailable()).toBe(true);
  });

  it('posts the wav to the OpenAI-compatible endpoint and returns the text', async () => {
    let capturedUrl = '';
    let capturedAuth = '';
    let capturedForm: FormData | null = null;
    const fetchImpl = (async (url: string, init: { headers: Record<string, string>; body: FormData }) => {
      capturedUrl = url;
      capturedAuth = init.headers.Authorization;
      capturedForm = init.body;
      return fakeResponse({ status: 200, jsonBody: { text: ' Hallo Welt ' } });
    }) as unknown as typeof fetch;

    const transcriber = new CloudWhisperTranscriber(CONFIG, fetchImpl);
    const result = await transcriber.transcribe(wavPath, { language: 'de', model: 'base' });

    expect(result.ok).toBe(true);
    expect(result.text).toBe('Hallo Welt');
    // Trailing slash on the base URL is normalized away.
    expect(capturedUrl).toBe('https://api.groq.com/openai/v1/audio/transcriptions');
    expect(capturedAuth).toBe('Bearer gsk_test');
    expect(capturedForm!.get('model')).toBe('whisper-large-v3-turbo');
    expect(capturedForm!.get('language')).toBe('de');
    expect(capturedForm!.get('response_format')).toBe('json');
    expect(capturedForm!.get('file')).toBeTruthy();
  });

  it('omits the language field on auto (lets the API detect)', async () => {
    let capturedForm: FormData | null = null;
    const fetchImpl = (async (_url: string, init: { body: FormData }) => {
      capturedForm = init.body;
      return fakeResponse({ status: 200, jsonBody: { text: 'hi' } });
    }) as unknown as typeof fetch;

    const transcriber = new CloudWhisperTranscriber(CONFIG, fetchImpl);
    await transcriber.transcribe(wavPath, { language: 'auto', model: 'base' });
    expect(capturedForm!.get('language')).toBeNull();
  });

  it('maps 401 to a German key error', async () => {
    const fetchImpl = (async () => fakeResponse({ status: 401, textBody: 'invalid key' })) as unknown as typeof fetch;
    const transcriber = new CloudWhisperTranscriber(CONFIG, fetchImpl);
    const result = await transcriber.transcribe(wavPath, { language: 'de', model: 'base' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('API-Key');
  });

  it('maps 429 to a rate-limit error', async () => {
    const fetchImpl = (async () => fakeResponse({ status: 429 })) as unknown as typeof fetch;
    const transcriber = new CloudWhisperTranscriber(CONFIG, fetchImpl);
    const result = await transcriber.transcribe(wavPath, { language: 'de', model: 'base' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('429');
  });

  it('includes the response detail on other HTTP errors', async () => {
    const fetchImpl = (async () => fakeResponse({ status: 500, textBody: 'kaputt' })) as unknown as typeof fetch;
    const transcriber = new CloudWhisperTranscriber(CONFIG, fetchImpl);
    const result = await transcriber.transcribe(wavPath, { language: 'de', model: 'base' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('HTTP 500');
    expect(result.error).toContain('kaputt');
  });

  it('returns Abgebrochen when the signal fires', async () => {
    const controller = new AbortController();
    const fetchImpl = (async (_url: string, init: { signal: AbortSignal }) => {
      controller.abort();
      const error = new Error('The operation was aborted');
      void init.signal;
      throw error;
    }) as unknown as typeof fetch;
    const transcriber = new CloudWhisperTranscriber(CONFIG, fetchImpl);
    const result = await transcriber.transcribe(wavPath, { language: 'de', model: 'base' }, controller.signal);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Abgebrochen');
  });
});
