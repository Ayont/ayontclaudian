import type { StreamChunk } from '../../../core/types';
import { formatCustomModelLabel } from '../modelLabels';

/** The two SDK system messages Claude Code emits when a model ends on `refusal`. */
export interface RefusalFallbackMessage {
  type: 'system';
  subtype: 'model_refusal_fallback';
  scope?: 'session' | 'local';
  original_model: string;
  fallback_model: string;
  api_refusal_category?: string | null;
}

export interface RefusalNoFallbackMessage {
  type: 'system';
  subtype: 'model_refusal_no_fallback';
  original_model: string;
  api_refusal_category?: string | null;
}

// Categories are an open set on the wire; unknown ones are shown as they arrive.
const CATEGORY_LABELS: Record<string, string> = {
  cyber: 'Cybersicherheit',
  bio: 'Biologie',
  reasoning_extraction: 'Offenlegung des Denkprozesses',
  frontier_llm: 'KI-Modellentwicklung',
};

function categorySuffix(category: string | null | undefined): string {
  if (!category) return '';
  return ` (Sicherheitsfilter: ${CATEGORY_LABELS[category] ?? category})`;
}

type NoticeChunk = Extract<StreamChunk, { type: 'notice' }>;
type AnySystemMessage = RefusalFallbackMessage | RefusalNoFallbackMessage | { type?: string; subtype?: string };

function isRefusalMessage(message: AnySystemMessage): message is RefusalFallbackMessage | RefusalNoFallbackMessage {
  return message.type === 'system'
    && (message.subtype === 'model_refusal_fallback' || message.subtype === 'model_refusal_no_fallback');
}

/**
 * Turns Claude Code's refusal events into a visible notice. Without it a refused
 * turn either ended in a bare error, or silently continued on another model
 * while the picker still named the original one.
 */
export function describeRefusalFallback(message: AnySystemMessage): NoticeChunk | null {
  if (!isRefusalMessage(message)) return null;
  const original = formatCustomModelLabel(message.original_model);
  const category = categorySuffix(message.api_refusal_category);

  if (message.subtype === 'model_refusal_no_fallback') {
    return {
      type: 'notice',
      level: 'warning',
      content: `${original} hat die Anfrage abgelehnt${category}. Kein Ausweichmodell verfügbar; Anfrage umformulieren oder ein anderes Modell wählen.`,
    };
  }

  const fallback = formatCustomModelLabel(message.fallback_model);
  // Older CLIs omit `scope`; they only ever swap the whole session.
  if (message.scope === 'local') {
    return {
      type: 'notice',
      level: 'warning',
      content: `${original} hat eine Teilanfrage abgelehnt${category}. Nur diese Antwort kam von ${fallback}; die Unterhaltung bleibt bei ${original}.`,
    };
  }
  return {
    type: 'notice',
    level: 'warning',
    content: `${original} hat die Anfrage abgelehnt${category}. ${fallback} antwortet stattdessen; diese Unterhaltung läuft ab jetzt mit ${fallback}.`,
  };
}
