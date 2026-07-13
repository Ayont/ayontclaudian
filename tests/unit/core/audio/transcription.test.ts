import {
  parseWhisperOutput,
  resolveVoiceLanguage,
  transcribeAudioFile,
} from '@/core/audio/transcription';
import type { VoiceTranscriber } from '@/core/audio/VoiceTranscriber';

describe('parseWhisperOutput', () => {
  it('strips timestamps and collapses whitespace', () => {
    const stdout = [
      '[00:00:00.000 --> 00:00:02.000]  Hallo Welt',
      '[00:00:02.000 --> 00:00:04.000]  das ist ein Test',
      '',
      '  mit  extra  spaces ',
    ].join('\n');
    expect(parseWhisperOutput(stdout)).toBe('Hallo Welt das ist ein Test mit extra spaces');
  });

  it('handles plain text without timestamps', () => {
    expect(parseWhisperOutput('Eine Zeile\nNoch eine')).toBe('Eine Zeile Noch eine');
  });

  it('returns empty for blank output', () => {
    expect(parseWhisperOutput('  \n  ')).toBe('');
  });
});

function fakeTranscriber(id: string, available: boolean, result?: { ok: boolean; text: string }): VoiceTranscriber {
  return {
    id,
    displayName: id,
    isAvailable: async () => available,
    transcribe: async () => result ?? { ok: true, text: '' },
  };
}

describe('transcribeAudioFile', () => {
  it('returns error when no backend is available', async () => {
    const result = await transcribeAudioFile('/tmp/test.wav', {
      language: 'de',
      model: 'base',
      backendFactories: [() => fakeTranscriber('none', false)],
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Kein Transkriptions-Backend verfügbar');
  });

  it('uses the first available backend and returns its result', async () => {
    const result = await transcribeAudioFile('/tmp/test.wav', {
      language: 'de',
      model: 'base',
      backendFactories: [
        () => fakeTranscriber('fast', false),
        () => fakeTranscriber('fallback', true, { ok: true, text: 'Hallo' }),
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.text).toBe('Hallo');
  });
});

describe('resolveVoiceLanguage', () => {
  it('returns explicit language when user chose one', () => {
    expect(resolveVoiceLanguage('de', 'en')).toBe('de');
    expect(resolveVoiceLanguage('fr', 'de')).toBe('fr');
  });

  it('falls back to plugin locale when set to auto', () => {
    expect(resolveVoiceLanguage('auto', 'de')).toBe('de');
    expect(resolveVoiceLanguage('auto', 'en')).toBe('en');
    expect(resolveVoiceLanguage('auto', 'ja')).toBe('ja');
  });

  it('keeps auto for unknown locales', () => {
    expect(resolveVoiceLanguage('auto', 'xx')).toBe('auto');
  });
});
