import type { ChatMessage, SubagentInfo, SubagentTimelineEntry, ToolCallInfo } from '../types';

/**
 * Cap for a single persisted tool result.
 *
 * `.claudian/sessions/<id>.meta.json` exists so Claudian can rebuild its OWN
 * transcript view after a restart. It is NOT the context the model sees — that
 * lives in the provider's native session (`~/.claude/projects/**.jsonl`,
 * `~/.codex/sessions/**.jsonl`), which the runtime resumes from. So the only
 * consumer of a persisted tool result is the collapsed tool card in the
 * transcript, which shows the first handful of lines behind an expander.
 *
 * Storing the full result anyway is what turned this file into a liability: a
 * single `Read` of a large source file persisted 540 KB, one assistant message
 * carried 62 such calls (3.2 MB), and a 59-message conversation reached 17 MB.
 * Across 252 conversations that is 264 MB — every byte of which
 * `listMetadata()` reads and `JSON.parse`s on the first awaited step of
 * `onload`, purely to read back a title and a timestamp.
 *
 * 8 KB keeps the visible portion of every tool card intact with room to spare
 * (the card renders ~20 lines) while removing the bulk.
 */
export const MAX_PERSISTED_TOOL_RESULT_CHARS = 8_000;

/** Appended so a truncated result never reads as a complete one. */
export const TRUNCATION_NOTICE = '\n\n[… gekürzt — vollständige Ausgabe nur in der laufenden Sitzung verfügbar]';

export function truncateResult(result: string, maxChars: number = MAX_PERSISTED_TOOL_RESULT_CHARS): string {
  if (result.length <= maxChars) {
    return result;
  }
  return result.slice(0, maxChars) + TRUNCATION_NOTICE;
}

/**
 * Cap for the text of a persisted user message. Pasted tables made single
 * session files 10 MB (content plus the same text again as displayContent),
 * and every tab load parses the file. The provider's own session keeps the
 * full prompt; Claudian's copy is what the transcript shows.
 */
export const MAX_PERSISTED_USER_TEXT_CHARS = 64_000;
/** A subagent's child tools keep a short preview each; the newest ones only. */
export const MAX_PERSISTED_SUBAGENT_TOOL_RESULT_CHARS = 2_000;
export const MAX_PERSISTED_SUBAGENT_TOOLS = 80;

/** Timeline entries kept per subagent on disk (the newest ones). */
export const MAX_PERSISTED_SUBAGENT_TIMELINE_ENTRIES = 120;
/** Text the persisted timeline may carry in total; older text goes first. */
export const MAX_PERSISTED_SUBAGENT_TEXT_CHARS = 24_000;
const MAX_PERSISTED_TIMELINE_TEXT_ENTRY_CHARS = 2_000;

/**
 * Keeps the newest part of a subagent's transcript within a fixed budget, so
 * the inspector can show it after a restart without bloating the session file.
 */
function toPersistedTimeline(timeline: readonly SubagentTimelineEntry[]): SubagentTimelineEntry[] {
  const kept: SubagentTimelineEntry[] = [];
  let textBudget = MAX_PERSISTED_SUBAGENT_TEXT_CHARS;
  for (let i = timeline.length - 1; i >= 0 && kept.length < MAX_PERSISTED_SUBAGENT_TIMELINE_ENTRIES; i--) {
    const entry = timeline[i];
    if (entry.type === 'tool') {
      kept.push(entry);
      continue;
    }
    if (textBudget <= 0) continue;
    const limit = Math.min(MAX_PERSISTED_TIMELINE_TEXT_ENTRY_CHARS, textBudget);
    const text = entry.text.length > limit ? `…${entry.text.slice(entry.text.length - limit + 1)}` : entry.text;
    textBudget -= text.length;
    kept.push({ ...entry, text });
  }
  return kept.reverse();
}

/**
 * Compacts a subagent's result and nested tool calls down to what is worth persisting.
 */
export function toPersistedSubagent(subagent: SubagentInfo): SubagentInfo {
  const result = typeof subagent.result === 'string' && subagent.result.length > MAX_PERSISTED_TOOL_RESULT_CHARS
    ? truncateResult(subagent.result)
    : subagent.result;

  const prompt = typeof subagent.prompt === 'string' && subagent.prompt.length > MAX_PERSISTED_TOOL_RESULT_CHARS
    ? truncateResult(subagent.prompt)
    : subagent.prompt;

  const toolCalls = subagent.toolCalls?.slice(-MAX_PERSISTED_SUBAGENT_TOOLS).map((tc: ToolCallInfo) => ({
    ...tc,
    result: typeof tc.result === 'string' && tc.result.length > MAX_PERSISTED_SUBAGENT_TOOL_RESULT_CHARS
      ? truncateResult(tc.result, MAX_PERSISTED_SUBAGENT_TOOL_RESULT_CHARS)
      : tc.result,
  }));

  return {
    ...subagent,
    result,
    prompt,
    ...(toolCalls ? { toolCalls } : {}),
    ...(subagent.timeline ? { timeline: toPersistedTimeline(subagent.timeline) } : {}),
  };
}

/**
 * Strips a message down to what is worth writing to disk.
 *
 * Immutable: returns new objects and leaves the in-memory message untouched, so
 * the running session keeps its full tool output on screen.
 */
function capUserText(text: string): string {
  return text.length > MAX_PERSISTED_USER_TEXT_CHARS ? truncateResult(text, MAX_PERSISTED_USER_TEXT_CHARS) : text;
}

export function toPersistedMessage(message: ChatMessage): ChatMessage {
  const images = message.images?.map((image) => ({ ...image, data: '' }));
  const userText = message.role === 'user' ? toPersistedUserText(message) : null;

  const toolCalls = message.toolCalls?.map((toolCall) => {
    let result = toolCall.result;
    if (typeof result === 'string' && result.length > MAX_PERSISTED_TOOL_RESULT_CHARS) {
      result = truncateResult(result);
    }
    let subagent = toolCall.subagent;
    if (subagent) {
      subagent = toPersistedSubagent(subagent);
    }
    return {
      ...toolCall,
      ...(result !== undefined ? { result } : {}),
      ...(subagent !== undefined ? { subagent } : {}),
    };
  });

  const persisted: ChatMessage = {
    ...message,
    ...(images ? { images } : {}),
    ...(toolCalls ? { toolCalls } : {}),
    ...(userText ? { content: userText.content } : {}),
  };
  if (userText) {
    if (userText.displayContent === undefined) delete persisted.displayContent;
    else persisted.displayContent = userText.displayContent;
  }
  return persisted;
}

/** Every reader falls back to `content` when `displayContent` is absent. */
function toPersistedUserText(message: ChatMessage): { content: string; displayContent?: string } {
  const content = capUserText(message.content ?? '');
  if (message.displayContent === undefined || message.displayContent === message.content) {
    return { content };
  }
  return { content, displayContent: capUserText(message.displayContent) };
}

/** Applies {@link toPersistedMessage} across a transcript. */
export function toPersistedMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map(toPersistedMessage);
}
