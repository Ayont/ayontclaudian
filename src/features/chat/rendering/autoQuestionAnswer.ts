import type { AskUserAnswers } from '../../../core/types/tools';

/**
 * Auto-mode answer resolution for the AskUserQuestion tool.
 *
 * Auto mode ("double YOLO") never blocks the chat with a clarifying prompt: it
 * answers each question by selecting the FIRST option, which the AskUserQuestion
 * convention reserves for the recommended choice. The result mirrors exactly what
 * {@link InlineAskUserQuestion} would emit on a manual submit, so downstream code
 * is identical whether a human or auto mode answered.
 */

interface RawOption {
  label?: unknown;
  value?: unknown;
  text?: unknown;
  name?: unknown;
  id?: unknown;
}

/** Resolves an option's submit value the same way the inline picker does (value ?? label ?? …). */
function optionValue(opt: unknown): string | null {
  if (typeof opt === 'string') return opt;
  if (typeof opt === 'number' || typeof opt === 'boolean' || typeof opt === 'bigint') {
    return `${opt}`;
  }
  if (opt && typeof opt === 'object' && !Array.isArray(opt)) {
    const o = opt as RawOption;
    if (typeof o.value === 'string') return o.value;
    if (typeof o.label === 'string') return o.label;
    if (typeof o.text === 'string') return o.text;
    if (typeof o.name === 'string') return o.name;
    if (typeof o.id === 'string') return o.id;
  }
  return null;
}

/**
 * Computes the auto-mode answer for an AskUserQuestion tool input.
 *
 * - Picks the first option's value for each answerable question.
 * - `multiSelect` questions get a single-element array.
 * - Free-text-only questions (`isOther`, no options) resolve to '' / [] (no preference).
 * - Returns `null` when nothing is answerable, so callers can fall back to the prompt.
 *
 * Pure: no DOM, no side effects.
 */
export function resolveAutoQuestionAnswers(
  input: Record<string, unknown>,
): AskUserAnswers | null {
  const raw = input?.questions;
  if (!Array.isArray(raw)) return null;

  const answers: AskUserAnswers = {};
  let answered = 0;

  for (const q of raw) {
    if (!q || typeof q !== 'object' || Array.isArray(q)) continue;
    const rec = q as Record<string, unknown>;
    if (typeof rec.question !== 'string') continue;

    const key = typeof rec.id === 'string' && rec.id ? rec.id : rec.question;
    const options = Array.isArray(rec.options) ? rec.options : [];
    const firstValue = options.length > 0 ? optionValue(options[0]) : null;
    const isMulti = rec.multiSelect === true;

    if (firstValue !== null) {
      answers[key] = isMulti ? [firstValue] : firstValue;
      answered++;
    } else if (rec.isOther === true) {
      answers[key] = isMulti ? [] : '';
      answered++;
    }
  }

  return answered > 0 ? answers : null;
}

/**
 * One-line, human-readable summary of what auto mode picked, for an inline
 * transparency note in the chat (e.g. "Which database? → postgres · Theme → dark").
 */
export function summarizeAutoAnswers(answers: AskUserAnswers): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(answers)) {
    const rendered = Array.isArray(value) ? value.join(', ') : value;
    const shortKey = key.length > 48 ? `${key.slice(0, 48)}…` : key;
    parts.push(rendered ? `${shortKey} → ${rendered}` : shortKey);
  }
  return parts.join(' · ');
}
