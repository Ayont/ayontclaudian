import {
  describeRefusalFallback,
  type RefusalFallbackMessage,
  type RefusalNoFallbackMessage,
} from '@/providers/claude/stream/refusalFallback';

// Wire messages carry more fields (uuid, trigger, request_id…) than the notice reads.
const base = { type: 'system' as const, uuid: 'u', session_id: 's', content: 'raw', request_id: null };
const fallbackMessage = (fields: Record<string, unknown>) => ({ ...base, ...fields }) as unknown as RefusalFallbackMessage;
const noFallbackMessage = (fields: Record<string, unknown>) => ({ ...base, ...fields }) as unknown as RefusalNoFallbackMessage;

describe('describeRefusalFallback', () => {
  it('explains a session-wide fallback with the category and the model now answering', () => {
    const notice = describeRefusalFallback(fallbackMessage({
      subtype: 'model_refusal_fallback',
      trigger: 'refusal',
      direction: 'retry',
      scope: 'session',
      original_model: 'claude-opus-5-5',
      fallback_model: 'claude-opus-5',
      api_refusal_category: 'cyber',
    }));

    expect(notice).toEqual({
      type: 'notice',
      level: 'warning',
      content: 'Opus 5.5 hat die Anfrage abgelehnt (Sicherheitsfilter: Cybersicherheit). Opus 5 antwortet stattdessen; diese Unterhaltung läuft ab jetzt mit Opus 5.',
    });
  });

  it('treats a missing scope from an older CLI as session-wide', () => {
    const notice = describeRefusalFallback(fallbackMessage({
      subtype: 'model_refusal_fallback',
      trigger: 'refusal',
      direction: 'retry',
      original_model: 'claude-opus-5-5',
      fallback_model: 'claude-opus-4-8',
    }));

    expect(notice?.content).toBe('Opus 5.5 hat die Anfrage abgelehnt. Opus 4.8 antwortet stattdessen; diese Unterhaltung läuft ab jetzt mit Opus 4.8.');
  });

  it('keeps a local fallback (subagent, side question) to that one answer', () => {
    const notice = describeRefusalFallback(fallbackMessage({
      subtype: 'model_refusal_fallback',
      trigger: 'refusal',
      direction: 'retry',
      scope: 'local',
      original_model: 'claude-opus-5-5',
      fallback_model: 'claude-opus-5',
      api_refusal_category: 'bio',
    }));

    expect(notice?.content).toBe('Opus 5.5 hat eine Teilanfrage abgelehnt (Sicherheitsfilter: Biologie). Nur diese Antwort kam von Opus 5; die Unterhaltung bleibt bei Opus 5.5.');
  });

  it('explains a refusal with no fallback', () => {
    const notice = describeRefusalFallback(noFallbackMessage({
      subtype: 'model_refusal_no_fallback',
      original_model: 'claude-opus-5-5',
      api_refusal_category: 'reasoning_extraction',
    }));

    expect(notice).toEqual({
      type: 'notice',
      level: 'warning',
      content: 'Opus 5.5 hat die Anfrage abgelehnt (Sicherheitsfilter: Offenlegung des Denkprozesses). Kein Ausweichmodell verfügbar; Anfrage umformulieren oder ein anderes Modell wählen.',
    });
  });

  it('shows an unknown category as it arrives instead of hiding it', () => {
    const notice = describeRefusalFallback(noFallbackMessage({
      subtype: 'model_refusal_no_fallback',
      original_model: 'claude-opus-5-5',
      api_refusal_category: 'new_category',
    }));

    expect(notice?.content).toContain('(Sicherheitsfilter: new_category)');
  });

  it('ignores other system messages', () => {
    expect(describeRefusalFallback({ ...base, subtype: 'init' } as never)).toBeNull();
  });
});
