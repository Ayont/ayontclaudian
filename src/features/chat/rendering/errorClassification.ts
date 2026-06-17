import { getLocale } from '../../../i18n/i18n';

/**
 * Turns a raw provider error/notice string into a structured, human-friendly
 * "status card" model: a clear title, a plain-language explanation, an
 * actionable hint, and a severity. Pattern-based and pure — no DOM, no network.
 *
 * Strings are bilingual (German for the `de` locale, English otherwise) so the
 * card reads naturally without touching all 10 locale JSON files; this mirrors
 * the renderer layer's existing self-contained-string convention.
 */

export type StatusSeverity = 'error' | 'warning' | 'info';

export interface ClassifiedError {
  severity: StatusSeverity;
  title: string;
  explanation: string;
  hint: string;
  retryable: boolean;
  isLimit: boolean;
  /** Original raw text, shown in the collapsible "technical details" disclosure. */
  raw: string;
  providerId: string;
}

// Markers StreamController emits for error/notice chunks (kept stable so old
// persisted messages upgrade to cards on reload too).
export const ERROR_MARKER = '❌ **Error:** ';
export const BLOCKED_MARKER = '⚠️ **Blocked:** ';
export const NOTICE_MARKER = '⚠️ **Notice:** ';

type Lang = 'de' | 'en';

interface Strings {
  title: string;
  explanation: string;
  hint: string;
}

function lang(): Lang {
  return getLocale() === 'de' ? 'de' : 'en';
}

const COPY: Record<string, Record<Lang, Strings>> = {
  limit: {
    de: {
      title: 'Limit erreicht',
      explanation:
        'Du hast das Anfrage- oder Kontingent-Limit des Anbieters erreicht. Das ist normal und löst sich von selbst.',
      hint: 'Warte auf den Reset, wechsle den Provider oder erhöhe dein Kontingent (Upgrade).',
    },
    en: {
      title: 'Limit reached',
      explanation:
        "You hit the provider's request or quota limit. This is normal and resolves on its own.",
      hint: 'Wait for the reset, switch provider, or upgrade your quota.',
    },
  },
  auth: {
    de: {
      title: 'Authentifizierung fehlgeschlagen',
      explanation: 'Der Anbieter konnte dich nicht authentifizieren. API-Key oder Login fehlt oder ist ungültig.',
      hint: 'Prüfe API-Key bzw. Login in den Einstellungen des Providers und versuche es erneut.',
    },
    en: {
      title: 'Authentication failed',
      explanation: 'The provider could not authenticate you. The API key or login is missing or invalid.',
      hint: "Check the provider's API key / login in settings, then try again.",
    },
  },
  invalidRequest: {
    de: {
      title: 'Ungültige Anfrage',
      explanation: 'Die Anfrage wurde vom Anbieter abgelehnt. Meist liegt es an einem ungültigen Parameter oder Befehl.',
      hint: 'Prüfe deine Eingabe oder den Slash-Befehl und versuche es erneut.',
    },
    en: {
      title: 'Invalid request',
      explanation: 'The provider rejected the request, usually due to an invalid parameter or command.',
      hint: 'Check your input or slash command and try again.',
    },
  },
  session: {
    de: {
      title: 'Sitzung nicht gefunden',
      explanation:
        'Die Konversations-Sitzung ist abgelaufen oder gehört zu einem anderen Provider (z. B. nach einem Provider-Wechsel).',
      hint: 'Starte eine neue Nachricht — die Sitzung wird automatisch neu aufgebaut.',
    },
    en: {
      title: 'Session not found',
      explanation:
        'The conversation session expired or belongs to a different provider (e.g. after switching providers).',
      hint: 'Send a new message — the session is rebuilt automatically.',
    },
  },
  network: {
    de: {
      title: 'Netzwerkfehler',
      explanation: 'Die Verbindung zum Anbieter ist fehlgeschlagen oder hat zu lange gedauert.',
      hint: 'Prüfe deine Internetverbindung und versuche es erneut.',
    },
    en: {
      title: 'Network error',
      explanation: 'The connection to the provider failed or timed out.',
      hint: 'Check your internet connection and try again.',
    },
  },
  cliMissing: {
    de: {
      title: 'CLI nicht gefunden oder deaktiviert',
      explanation: 'Die CLI des Anbieters ist nicht installiert, der Pfad ist falsch oder der Provider ist deaktiviert.',
      hint: 'Setze den CLI-Pfad bzw. aktiviere den Provider in den Einstellungen.',
    },
    en: {
      title: 'CLI not found or disabled',
      explanation: "The provider's CLI is not installed, the path is wrong, or the provider is disabled.",
      hint: 'Set the CLI path or enable the provider in settings.',
    },
  },
  processExit: {
    de: {
      title: 'CLI-Prozess beendet',
      explanation: 'Der CLI-Prozess des Anbieters wurde unerwartet beendet.',
      hint: 'Versuche es erneut. Bleibt der Fehler, prüfe CLI-Pfad und Installation in den Einstellungen.',
    },
    en: {
      title: 'CLI process exited',
      explanation: "The provider's CLI process exited unexpectedly.",
      hint: 'Try again. If it persists, check the CLI path and installation in settings.',
    },
  },
  contextWindow: {
    de: {
      title: 'Kontextfenster voll',
      explanation: 'Die native Provider-Sitzung ist zu groß geworden und passt nicht mehr in das Modell-Kontextfenster.',
      hint: 'Claudian setzt diese Provider-Sitzung automatisch zurück, wenn möglich. Falls der Fehler bleibt, starte einen neuen Tab oder kürze die Eingabe.',
    },
    en: {
      title: 'Context window full',
      explanation: "The provider's native session grew too large for the model context window.",
      hint: 'Claudian resets that provider session automatically when possible. If it persists, start a new tab or shorten the prompt.',
    },
  },
  unknown: {
    de: {
      title: 'Unerwarteter Fehler',
      explanation: 'Beim Anbieter ist ein unerwarteter Fehler aufgetreten.',
      hint: 'Versuche es erneut. Die technischen Details findest du unten.',
    },
    en: {
      title: 'Unexpected error',
      explanation: 'The provider returned an unexpected error.',
      hint: 'Try again. The technical details are below.',
    },
  },
  noticeBlocked: {
    de: { title: 'Aktion blockiert', explanation: '', hint: '' },
    en: { title: 'Action blocked', explanation: '', hint: '' },
  },
  noticeInfo: {
    de: { title: 'Hinweis', explanation: '', hint: '' },
    en: { title: 'Notice', explanation: '', hint: '' },
  },
};

const LABELS: Record<Lang, { rawDetails: string; limitBadge: string }> = {
  de: { rawDetails: 'Technische Details', limitBadge: 'Limit' },
  en: { rawDetails: 'Technical details', limitBadge: 'Limit' },
};

export function statusCardLabels(): { rawDetails: string; limitBadge: string } {
  return LABELS[lang()];
}

interface Rule {
  key: keyof typeof COPY;
  severity: StatusSeverity;
  isLimit: boolean;
  retryable: boolean;
  patterns: string[];
}

// First match wins. Order matters: `limit` is checked before generic exit
// codes (a `code 75` is a quota signal, not a generic crash), and `session`
// before `cliMissing` so "… not found" session errors aren't mislabeled.
const RULES: Rule[] = [
  {
    key: 'limit',
    severity: 'warning',
    isLimit: true,
    retryable: true,
    patterns: ['429', 'rate_limit', 'rate limit', 'quota', 'usage limit', 'too many requests', 'exited with code 75', 'code 75', 'billing'],
  },
  {
    key: 'auth',
    severity: 'error',
    isLimit: false,
    retryable: false,
    patterns: ['unauthorized', 'api key', 'api-key', 'invalid api key', 'not logged in', 'login state', 'authentication', ' 401', ' 403', 'http 401', 'http 403'],
  },
  {
    key: 'invalidRequest',
    severity: 'error',
    isLimit: false,
    retryable: false,
    patterns: ['invalid_request', 'invalid request', 'bad request', ' 400', 'http 400'],
  },
  {
    key: 'session',
    severity: 'warning',
    isLimit: false,
    retryable: true,
    patterns: ['session expired', 'session not found', 'invalid session', 'session invalid', 'no conversation found', 'no such session', 'no rollout', 'does not exist'],
  },
  {
    key: 'network',
    severity: 'warning',
    isLimit: false,
    retryable: true,
    patterns: ['timeout', 'timed out', 'etimedout', 'econnreset', 'econnrefused', 'network', 'socket hang', 'fetch failed'],
  },
  {
    key: 'cliMissing',
    severity: 'error',
    isLimit: false,
    retryable: false,
    patterns: ['could not find', 'not found', 'is disabled', 'set the cli path', 'binary'],
  },
  {
    key: 'contextWindow',
    severity: 'warning',
    isLimit: false,
    retryable: true,
    patterns: ['ran out of room', 'context window', 'clear earlier history', 'maximum context', 'context length'],
  },
  {
    key: 'processExit',
    severity: 'error',
    isLimit: false,
    retryable: true,
    patterns: ['exited with code', 'process exited', 'subprocess exited', 'failed to start', 'not ready'],
  },
];

/**
 * Classify a raw provider error string into a status-card model.
 */
export function classifyProviderError(rawContent: string, providerId = ''): ClassifiedError {
  const raw = (rawContent ?? '').trim();
  const haystack = raw.toLowerCase();
  const l = lang();

  for (const rule of RULES) {
    if (rule.patterns.some((p) => haystack.includes(p))) {
      const copy = COPY[rule.key][l];
      return {
        severity: rule.severity,
        title: copy.title,
        explanation: copy.explanation,
        hint: copy.hint,
        retryable: rule.retryable,
        isLimit: rule.isLimit,
        raw,
        providerId,
      };
    }
  }

  const copy = COPY.unknown[l];
  return {
    severity: 'error',
    title: copy.title,
    explanation: copy.explanation,
    hint: copy.hint,
    retryable: true,
    isLimit: false,
    raw,
    providerId,
  };
}

function noticeCard(severity: 'warning' | 'info', raw: string): ClassifiedError {
  const copy = COPY[severity === 'warning' ? 'noticeBlocked' : 'noticeInfo'][lang()];
  const trimmed = (raw ?? '').trim();
  return {
    severity,
    title: copy.title,
    explanation: trimmed,
    hint: '',
    retryable: false,
    isLimit: false,
    raw: trimmed,
    providerId: '',
  };
}

/**
 * If `markdown` is an error/notice marker block (as emitted by StreamController),
 * return its classified status-card model; otherwise null. Used by the renderer
 * so the SAME path drives live streaming and reloaded history.
 */
export function detectStatusCard(markdown: string): ClassifiedError | null {
  const trimmed = (markdown ?? '').trim();
  if (trimmed.startsWith(ERROR_MARKER)) {
    return classifyProviderError(trimmed.slice(ERROR_MARKER.length));
  }
  if (trimmed.startsWith(BLOCKED_MARKER)) {
    return noticeCard('warning', trimmed.slice(BLOCKED_MARKER.length));
  }
  if (trimmed.startsWith(NOTICE_MARKER)) {
    return noticeCard('info', trimmed.slice(NOTICE_MARKER.length));
  }
  return null;
}
