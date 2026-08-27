/**
 * Claudian - Session Utilities
 *
 * Session recovery and history reconstruction.
 */

import { stripGoalBlocks } from '../core/conversation/goalPrompt';
import type { ChatMessage, ToolCallInfo } from '../core/types';
import { extractUserDisplayContent, extractUserQuery, formatCurrentNote } from './context';

// ============================================
// Session Recovery
// ============================================

const SESSION_ERROR_PATTERNS = [
  'session expired',
  'session not found',
  'invalid session',
  'session invalid',
  'no conversation found',
  'no such session',
  'process exited with code',
] as const;

const SESSION_ERROR_COMPOUND_PATTERNS = [
  { includes: ['session', 'expired'] },
  { includes: ['resume', 'failed'] },
  { includes: ['resume', 'error'] },
  // "session id not found", "the session was not found", "no session ... found":
  // resuming a session that doesn't exist (e.g. after switching providers in the
  // same chat, where the stored id belongs to a different provider). Triggers the
  // history-rebuild cold-restart recovery instead of surfacing a raw error.
  { includes: ['session', 'not found'] },
  { includes: ['session', 'does not exist'] },
] as const;

export function isSessionExpiredError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message.toLowerCase() : '';

  for (const pattern of SESSION_ERROR_PATTERNS) {
    if (msg.includes(pattern)) {
      return true;
    }
  }

  for (const { includes } of SESSION_ERROR_COMPOUND_PATTERNS) {
    if (includes.every(part => msg.includes(part))) {
      return true;
    }
  }

  return false;
}

// ============================================
// History Reconstruction
// ============================================

/** Roughly six thousand tokens of replayed history at four characters/token. */
export const HISTORY_CONTEXT_CHAR_CAP = 24_000;
const EARLIER_TURNS_OMITTED_NOTE = '[earlier turns omitted]';
const MESSAGE_MIDDLE_OMITTED_NOTE = '[message middle omitted]';

/**
 * Formats tool input for inclusion in rebuilt context.
 * Includes all non-null parameters, truncates long string values.
 */
function formatToolInput(input: Record<string, unknown>, maxLength = 200): string {
  if (!input || Object.keys(input).length === 0) return '';

  try {
    const parts: string[] = [];
    for (const [key, value] of Object.entries(input)) {
      if (value === undefined || value === null) continue;

      let valueStr: string;
      if (typeof value === 'string') {
        valueStr = value.length > 100 ? `${value.slice(0, 100)}...` : value;
      } else if (typeof value === 'object') {
        valueStr = '[object]';
      } else if (typeof value === 'function') {
        valueStr = '[function]';
      } else if (typeof value === 'symbol') {
        valueStr = value.description ? `[symbol:${value.description}]` : '[symbol]';
      } else if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
        valueStr = `${value}`;
      } else {
        valueStr = '[unknown]';
      }
      parts.push(`${key}=${valueStr}`);
    }

    const result = parts.join(', ');
    return result.length > maxLength ? `${result.slice(0, maxLength)}...` : result;
  } catch {
    return '[input formatting error]';
  }
}

/**
 * Formats a tool call for inclusion in rebuilt context.
 *
 * Strategy:
 * - Always include tool name and input (so Claude knows what was attempted)
 * - Only include results for failed tools (errors are important to remember)
 * - Successful tools can be re-executed if needed
 */
export function formatToolCallForContext(toolCall: ToolCallInfo, maxErrorLength = 500): string {
  const status = toolCall.status ?? 'completed';
  const isFailed = status === 'error' || status === 'blocked';
  const inputStr = formatToolInput(toolCall.input);
  const inputPart = inputStr ? ` input: ${inputStr}` : '';

  if (!isFailed) {
    return `[Tool ${toolCall.name}${inputPart} status=${status}]`;
  }

  const hasResult = typeof toolCall.result === 'string' && toolCall.result.trim().length > 0;
  if (!hasResult) {
    return `[Tool ${toolCall.name}${inputPart} status=${status}]`;
  }

  const errorMsg = truncateToolResult(toolCall.result as string, maxErrorLength);
  return `[Tool ${toolCall.name}${inputPart} status=${status}] error: ${errorMsg}`;
}

export function truncateToolResult(result: string, maxLength = 500): string {
  if (result.length > maxLength) {
    return `${result.slice(0, maxLength)}... (truncated)`;
  }
  return result;
}

export function formatContextLine(message: ChatMessage): string | null {
  if (!message.currentNote) {
    return null;
  }
  return formatCurrentNote(message.currentNote);
}

/**
 * Formats thinking blocks for inclusion in rebuilt context.
 * Just indicates that thinking occurred (content not included - Claude will think anew).
 */
function formatThinkingBlocks(message: ChatMessage): string[] {
  if (!message.contentBlocks) return [];

  const thinkingBlocks = message.contentBlocks.filter(
    (block): block is { type: 'thinking'; content: string; durationSeconds?: number } =>
      block.type === 'thinking'
  );

  if (thinkingBlocks.length === 0) return [];

  const totalDuration = thinkingBlocks.reduce(
    (sum, block) => sum + (block.durationSeconds ?? 0),
    0
  );

  const durationPart = totalDuration > 0 ? `, ${totalDuration.toFixed(1)}s total` : '';
  return [`[Thinking: ${thinkingBlocks.length} block(s)${durationPart}]`];
}

export function buildContextFromHistory(messages: ChatMessage[]): string {
  const parts: string[] = [];

  for (const message of messages) {
    if (message.role !== 'user' && message.role !== 'assistant') {
      continue;
    }

    if (message.isInterrupt) {
      continue;
    }

    if (message.role === 'assistant') {
      const hasContent = message.content && message.content.trim().length > 0;
      const hasToolCalls = message.toolCalls && message.toolCalls.length > 0;
      const hasThinking = message.contentBlocks?.some(b => b.type === 'thinking');
      if (!hasContent && !hasToolCalls && !hasThinking) {
        continue;
      }
    }

    const role = message.role === 'user' ? 'User' : 'Assistant';
    const lines: string[] = [];
    // Persisted user messages may contain the complete provider transport prompt
    // (RAG, memory, output manuals and the standing goal). Replaying that internal
    // payload on every stateless turn both leaks UI-only metadata and multiplies
    // token usage. Prefer the exact visible text saved with the message, then use
    // the shared display sanitizer for older conversations that predate it.
    const rawContent = message.content ?? '';
    let content: string;
    if (message.role === 'user') {
      const extractedDisplay = extractUserDisplayContent(rawContent);
      content = message.displayContent !== undefined
        ? message.displayContent.trim()
        : extractedDisplay !== undefined
          ? extractedDisplay.trim()
          : stripGoalBlocks(rawContent).trim();
    } else {
      content = stripGoalBlocks(rawContent).trim();
    }
    const contextLine = formatContextLine(message);

    const userPayload = contextLine
      ? content
        ? `${contextLine}\n\n${content}`
        : contextLine
      : content;

    lines.push(userPayload ? `${role}: ${userPayload}` : `${role}:`);

    if (message.role === 'assistant') {
      const thinkingLines = formatThinkingBlocks(message);
      if (thinkingLines.length > 0) {
        lines.push(...thinkingLines);
      }
    }

    if (message.role === 'assistant' && message.toolCalls?.length) {
      const toolLines = message.toolCalls
        .map(tc => formatToolCallForContext(tc))
        .filter(Boolean);
      if (toolLines.length > 0) {
        lines.push(...toolLines);
      }
    }

    parts.push(lines.join('\n'));
  }

  return parts.join('\n\n');
}

/**
 * Builds prompt-safe history without allowing long conversations to grow every
 * subsequent stateless provider turn without bound. Recent turns win; the full
 * context is returned unchanged when it already fits.
 */
export function buildBoundedContextFromHistory(
  messages: ChatMessage[],
  maxChars = HISTORY_CONTEXT_CHAR_CAP,
): string {
  if (maxChars <= 0 || messages.length === 0) {
    return '';
  }

  const full = buildContextFromHistory(messages).trim();
  if (full.length <= maxChars) {
    return full;
  }

  const prefix = `${EARLIER_TURNS_OMITTED_NOTE}\n\n`;
  if (prefix.length >= maxChars) {
    return prefix.slice(0, maxChars);
  }

  const bodyBudget = maxChars - prefix.length;
  for (let start = 1; start < messages.length; start += 1) {
    const tail = buildContextFromHistory(messages.slice(start)).trim();
    if (tail && tail.length <= bodyBudget) {
      return `${prefix}${tail}`;
    }
  }

  // A single recent renderable message can itself exceed the cap. Keep its
  // beginning (including the role marker) and enforce the hard boundary.
  for (let start = messages.length - 1; start >= 0; start -= 1) {
    const latest = buildContextFromHistory(messages.slice(start)).trim();
    if (latest) {
      const middleMarker = `\n\n${MESSAGE_MIDDLE_OMITTED_NOTE}\n\n`;
      if (bodyBudget <= middleMarker.length + 2) {
        return `${prefix}${latest.slice(0, bodyBudget).trimEnd()}`;
      }
      const remaining = bodyBudget - middleMarker.length;
      const headLength = Math.ceil(remaining / 2);
      const tailLength = remaining - headLength;
      return prefix
        + latest.slice(0, headLength).trimEnd()
        + middleMarker
        + latest.slice(-tailLength).trimStart();
    }
  }

  return '';
}

export function getLastUserMessage(messages: ChatMessage[]): ChatMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      return messages[i];
    }
  }
  return undefined;
}

/**
 * Builds a prompt with history context for session recovery.
 * Avoids duplicating the current prompt if it's already the last user message.
 */
export function buildPromptWithHistoryContext(
  historyContext: string | null,
  prompt: string,
  actualPrompt: string,
  conversationHistory: ChatMessage[]
): string {
  if (!historyContext) return prompt;

  const lastUserIndex = findLastUserMessageIndex(conversationHistory);
  const lastUserMessage = lastUserIndex >= 0 ? conversationHistory[lastUserIndex] : undefined;

  // Compare actual user queries, not XML-wrapped transport versions.
  const lastUserQuery = lastUserMessage?.displayContent
    ?? extractUserDisplayContent(lastUserMessage?.content ?? '')
    ?? extractUserQuery(lastUserMessage?.content ?? '');
  const currentUserQuery = extractUserQuery(actualPrompt);
  const pendingDuplicate = Boolean(
    lastUserMessage
    && lastUserQuery.trim() === currentUserQuery.trim()
    && !hasCompletedAssistantReplyAfter(conversationHistory, lastUserIndex + 1),
  );

  if (pendingDuplicate && lastUserMessage) {
    // InputController persists the visible user bubble before starting the
    // provider. Remove that sanitized duplicate, then append the fully prepared
    // turn exactly once. Returning `historyContext` alone used to discard RAG,
    // current-note, standing-goal, and output-surface envelopes on cold starts.
    const priorHistory = buildBoundedContextFromHistory(
      conversationHistory.filter((_, index) => index !== lastUserIndex),
    );
    const preparedPrompt = restoreMissingCurrentNote(prompt, lastUserMessage);
    return priorHistory ? `${priorHistory}\n\nUser: ${preparedPrompt}` : preparedPrompt;
  }

  return `${historyContext}\n\nUser: ${prompt}`;
}

function restoreMissingCurrentNote(prompt: string, message: ChatMessage): string {
  if (!message.currentNote || /<current_note(?:\s|>)/.test(prompt)) {
    return prompt;
  }
  return `${prompt}\n\n${formatCurrentNote(message.currentNote)}`;
}

function findLastUserMessageIndex(messages: ChatMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'user') return index;
  }
  return -1;
}

function hasCompletedAssistantReplyAfter(messages: ChatMessage[], startIndex: number): boolean {
  return messages.slice(startIndex).some((message) => {
    if (message.role !== 'assistant' || message.isInterrupt) return false;
    return Boolean(
      message.content?.trim()
      || message.toolCalls?.length
      || message.contentBlocks?.some((block) => block.type === 'thinking'),
    );
  });
}
