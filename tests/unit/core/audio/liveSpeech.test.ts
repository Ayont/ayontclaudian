import {
  isLiveSpeechSupported,
  mapVoiceLanguageToBcp47,
  type SpeechRecognitionLike,
  startLiveSpeech,
} from '@/core/audio/liveSpeech';

describe('mapVoiceLanguageToBcp47', () => {
  it('maps whisper codes to speech-recognition locales', () => {
    expect(mapVoiceLanguageToBcp47('de')).toBe('de-DE');
    expect(mapVoiceLanguageToBcp47('en')).toBe('en-US');
    expect(mapVoiceLanguageToBcp47('fr')).toBe('fr-FR');
  });

  it('keeps an already-specific locale and defaults auto to German', () => {
    expect(mapVoiceLanguageToBcp47('de-AT')).toBe('de-AT');
    expect(mapVoiceLanguageToBcp47('auto')).toBe('de-DE');
    expect(mapVoiceLanguageToBcp47('')).toBe('de-DE');
  });
});

describe('isLiveSpeechSupported', () => {
  it('is false without a SpeechRecognition constructor', () => {
    expect(isLiveSpeechSupported({})).toBe(false);
  });

  it('is true when webkitSpeechRecognition exists', () => {
    expect(isLiveSpeechSupported({
      webkitSpeechRecognition: class FakeRecognition {},
    })).toBe(true);
  });
});

describe('startLiveSpeech', () => {
  class FakeSpeechRecognition {
    continuous = false;
    interimResults = false;
    lang = '';
    onresult: ((event: unknown) => void) | null = null;
    onerror: ((event: { error: string }) => void) | null = null;
    onend: (() => void) | null = null;
    startCalls = 0;
    stopCalls = 0;

    start(): void {
      this.startCalls += 1;
    }

    stop(): void {
      this.stopCalls += 1;
      this.onend?.();
    }
  }

  it('streams interim and final transcripts to the callbacks', () => {
    const interims: string[] = [];
    const finals: string[] = [];
    const fake = new FakeSpeechRecognition();
    const session = startLiveSpeech({
      language: 'de',
      createRecognition: () => fake as unknown as SpeechRecognitionLike,
      onInterim: (text) => interims.push(text),
      onFinal: (text) => finals.push(text),
    });

    expect(fake.lang).toBe('de-DE');
    expect(fake.continuous).toBe(true);
    expect(fake.interimResults).toBe(true);
    expect(fake.startCalls).toBe(1);

    fake.onresult?.({
      resultIndex: 0,
      results: [
        { isFinal: false, 0: { transcript: 'hallo ' } },
        { isFinal: true, 0: { transcript: 'hallo niccolo' } },
      ],
    });

    expect(interims).toEqual(['hallo']);
    expect(finals).toEqual(['hallo niccolo']);

    session.stop();
    expect(fake.stopCalls).toBe(1);
  });

  it('reports a recognition error and still stops cleanly', () => {
    const errors: string[] = [];
    const fake = new FakeSpeechRecognition();
    const session = startLiveSpeech({
      language: 'de',
      createRecognition: () => fake as unknown as SpeechRecognitionLike,
      onError: (error) => errors.push(error),
    });
    fake.onerror?.({ error: 'network' });
    session.stop();
    expect(errors).toEqual(['network']);
  });
});
