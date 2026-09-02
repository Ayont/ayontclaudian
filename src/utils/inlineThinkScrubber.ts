/**
 * Delta-safe scrubber for reasoning that leaks into the text channel as
 * `<think>…</think>` (also `<thinking>`, `<reasoning>`).
 *
 * OpenAI-compatible gateways (Kimi, DeepSeek dsh, Freebuff, Mistral vibe, pi
 * with MiniMax/Qwen/DeepSeek-R1) sometimes forward the model's reasoning tags
 * inside `content` instead of `reasoning_content`. Rendered as markdown they
 * either show up as raw tags or, worse, an HTML-ish `<think>` swallows the rest
 * of the message. Hermes hit the same wall (#17924): a per-delta regex fails
 * the moment a tag is split across deltas.
 *
 * This is a small state machine that:
 *   - holds back a trailing partial `<`-run until it is clearly a tag or not,
 *   - streams thinking content incrementally (no whole-block buffering),
 *   - ignores tags inside fenced or inline code, where they are literal.
 */

export interface ScrubbedPart {
  kind: 'text' | 'thinking';
  content: string;
}

export interface InlineThinkScrubber {
  feed(delta: string): ScrubbedPart[];
  /** End of stream: releases held bytes. Unclosed thinking stays thinking. */
  flush(): ScrubbedPart[];
}

const TAG_NAMES = ['think', 'thinking', 'reasoning'] as const;
const OPEN_TAGS = TAG_NAMES.map((name) => `<${name}>`);
const CLOSE_TAGS = TAG_NAMES.map((name) => `</${name}>`);
const ALL_TAGS = [...OPEN_TAGS, ...CLOSE_TAGS];
const MAX_TAG = Math.max(...ALL_TAGS.map((tag) => tag.length));

function matchTagAt(buffer: string, index: number, tags: readonly string[]): string | null {
  for (const tag of tags) {
    if (buffer.startsWith(tag, index)) return tag;
  }
  return null;
}

/** Could `fragment` still grow into one of `tags`? */
function isTagPrefix(fragment: string, tags: readonly string[]): boolean {
  return tags.some((tag) => tag.length > fragment.length && tag.startsWith(fragment));
}

export function createInlineThinkScrubber(): InlineThinkScrubber {
  let inThinking = false;
  let inFence: { marker: string; length: number } | null = null;
  let atLineStart = true;
  let inlineTicks = 0; // >0 while inside an inline code span of that many backticks
  let held = '';

  const parts: ScrubbedPart[] = [];
  const push = (kind: ScrubbedPart['kind'], content: string): void => {
    if (!content) return;
    const last = parts[parts.length - 1];
    if (last && last.kind === kind) last.content += content;
    else parts.push({ kind, content });
  };
  const emit = (content: string): void => push(inThinking ? 'thinking' : 'text', content);

  /** Tracks fence / inline-code state for `line` text that has been emitted. */
  const trackCode = (text: string): void => {
    let i = 0;
    while (i < text.length) {
      if (atLineStart) {
        const match = /^ {0,3}(`{3,}|~{3,})/.exec(text.slice(i));
        if (match) {
          const run = match[1];
          if (inFence) {
            if (run[0] === inFence.marker && run.length >= inFence.length) inFence = null;
          } else {
            inFence = { marker: run[0], length: run.length };
            inlineTicks = 0;
          }
          const eol = text.indexOf('\n', i);
          i = eol === -1 ? text.length : eol + 1;
          atLineStart = eol !== -1;
          continue;
        }
      }
      const ch = text[i];
      if (ch === '\n') {
        atLineStart = true;
        i += 1;
        continue;
      }
      atLineStart = false;
      if (!inFence && ch === '`') {
        let run = 0;
        while (text[i + run] === '`') run += 1;
        if (inlineTicks === 0) inlineTicks = run;
        else if (inlineTicks === run) inlineTicks = 0;
        i += run;
        continue;
      }
      i += 1;
    }
  };

  const process = (final: boolean): void => {
    let cursor = 0;
    while (cursor < held.length) {
      const lt = held.indexOf('<', cursor);
      if (lt === -1) {
        const text = held.slice(cursor);
        emit(text);
        trackCode(text);
        cursor = held.length;
        break;
      }
      // Text before the '<'.
      const before = held.slice(cursor, lt);
      emit(before);
      trackCode(before);
      cursor = lt;

      const literal = inFence !== null || inlineTicks > 0;
      const tag = matchTagAt(held, lt, ALL_TAGS);
      if (tag) {
        if (literal) {
          emit(tag);
          trackCode(tag);
        } else if (OPEN_TAGS.includes(tag)) {
          inThinking = true;
        } else {
          inThinking = false;
        }
        cursor = lt + tag.length;
        continue;
      }
      const fragment = held.slice(lt, Math.min(held.length, lt + MAX_TAG));
      if (!final && held.length - lt < MAX_TAG && isTagPrefix(fragment, ALL_TAGS)) {
        // Might still become a tag — hold it for the next delta.
        break;
      }
      emit('<');
      trackCode('<');
      cursor = lt + 1;
    }
    held = held.slice(cursor);
  };

  return {
    feed(delta) {
      parts.length = 0;
      held += delta;
      process(false);
      return parts.splice(0);
    },
    flush() {
      parts.length = 0;
      process(true);
      held = '';
      return parts.splice(0);
    },
  };
}
