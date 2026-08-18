const LANGUAGE_TO_BCP47: Record<string, string> = {
  de: 'de-DE',
  en: 'en-US',
  fr: 'fr-FR',
  es: 'es-ES',
  it: 'it-IT',
  pt: 'pt-PT',
  nl: 'nl-NL',
  ja: 'ja-JP',
  zh: 'zh-CN',
  ko: 'ko-KR',
  ru: 'ru-RU',
  ar: 'ar-SA',
  hi: 'hi-IN',
  tr: 'tr-TR',
  pl: 'pl-PL',
  sv: 'sv-SE',
  da: 'da-DK',
  fi: 'fi-FI',
  no: 'nb-NO',
};

export function mapVoiceLanguageToBcp47(language: string): string {
  const trimmed = language.trim();
  if (!trimmed || trimmed === 'auto') return 'de-DE';
  if (trimmed.includes('-')) return trimmed;
  return LANGUAGE_TO_BCP47[trimmed] ?? trimmed;
}

export interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionResultEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

export interface SpeechRecognitionResultEventLike {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0?: { transcript?: string };
  }>;
}

export interface LiveSpeechHost {
  SpeechRecognition?: (new () => SpeechRecognitionLike) | undefined;
  webkitSpeechRecognition?: (new () => SpeechRecognitionLike) | undefined;
}

export interface LiveSpeechCallbacks {
  language?: string;
  host?: LiveSpeechHost;
  createRecognition?: () => SpeechRecognitionLike;
  onInterim?: (text: string) => void;
  onFinal?: (text: string) => void;
  onError?: (error: string) => void;
}

export interface LiveSpeechSession {
  stop(): void;
}

function asHost(value: object): LiveSpeechHost {
  return value as LiveSpeechHost;
}

function resolveCtor(host: LiveSpeechHost): (new () => SpeechRecognitionLike) | null {
  if (typeof host.SpeechRecognition === 'function') return host.SpeechRecognition;
  if (typeof host.webkitSpeechRecognition === 'function') return host.webkitSpeechRecognition;
  return null;
}

export function isLiveSpeechSupported(host: object = typeof window === 'undefined' ? {} : window): boolean {
  return resolveCtor(asHost(host)) !== null;
}

/**
 * Browser / Electron live dictation. Free, no install, text appears while
 * speaking. Electron often lacks the Google speech endpoint — callers must
 * keep a recorded fallback and treat `onError` as "use the file backend".
 */
export function startLiveSpeech(callbacks: LiveSpeechCallbacks): LiveSpeechSession {
  const recognition = callbacks.createRecognition
    ? callbacks.createRecognition()
    : createDefaultRecognition(callbacks.host);
  if (!recognition) {
    callbacks.onError?.('unsupported');
    return { stop() { /* nothing started */ } };
  }

  let stopped = false;
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = mapVoiceLanguageToBcp47(callbacks.language ?? 'auto');
  recognition.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      const transcript = result?.[0]?.transcript?.trim() ?? '';
      if (!transcript) continue;
      if (result.isFinal) {
        callbacks.onFinal?.(transcript);
      } else {
        interim = interim ? `${interim} ${transcript}` : transcript;
      }
    }
    if (interim) callbacks.onInterim?.(interim);
  };
  recognition.onerror = (event) => {
    callbacks.onError?.(event.error || 'error');
  };
  recognition.onend = () => {
    if (!stopped) {
      try {
        recognition.start();
      } catch {
        // Engine refused a restart — the file fallback will finish the turn.
      }
    }
  };

  recognition.start();
  return {
    stop() {
      stopped = true;
      try {
        recognition.stop();
      } catch {
        // Already stopped.
      }
    },
  };
}

function createDefaultRecognition(host?: LiveSpeechHost): SpeechRecognitionLike | null {
  const resolved = asHost(host ?? (typeof window === 'undefined' ? {} : window));
  const Ctor = resolveCtor(resolved);
  return Ctor ? new Ctor() : null;
}
