import type { ChatMessage, StreamChunk, ToolCallInfo } from '../../../core/types';
import {
  humanizeVibeTool,
  isToolResultError,
  joinTextParts,
  joinThinkParts,
  parseVibeStream,
  renderToolResult,
  type VibeStreamEvent,
} from './streamEvents';

/**
 * Maps Vibe `stream-json` events onto the plugin's stream + message contracts.
 *
 * Unlike antigravity's transcript schema (one growing step with text deltas),
 * Vibe delivers each assistant turn WHOLE — there are no partial deltas. So the
 * live mapper emits the full thinking/text of a line the first time that exact
 * payload is seen, and de-dupes `tool_use` (by call id) and `tool_result` (by
 * `tool_call_id`). Re-processing the same buffer (e.g. across stdout reads) is
 * idempotent because every emission is keyed.
 */

/** Per-turn streaming state, threaded across stdout reads. */
export interface VibeStreamState {
  /** Hashes of assistant text payloads already emitted. */
  emittedText: Set<string>;
  /** Hashes of reasoning payloads already emitted. */
  emittedThinking: Set<string>;
  /** Tool-call ids whose `tool_use` chunk has been emitted. */
  emittedToolUse: Set<string>;
  /** `tool_call_id`s whose `tool_result` chunk has been emitted. */
  emittedToolResult: Set<string>;
  /** Maps a tool-call id to its humanized name (for fallback result naming). */
  toolNames: Map<string, string>;
}

/** Fresh streaming state for a new query loop. */
export function createVibeStreamState(): VibeStreamState {
  return {
    emittedText: new Set<string>(),
    emittedThinking: new Set<string>(),
    emittedToolUse: new Set<string>(),
    emittedToolResult: new Set<string>(),
    toolNames: new Map<string, string>(),
  };
}

function toolResultId(event: VibeStreamEvent, fallbackIndex: number): string {
  if (event.toolCallId && event.toolCallId.trim()) {
    return event.toolCallId.trim();
  }
  return `vibe-tool-result-${fallbackIndex}`;
}

/**
 * Maps a single parsed stream event onto live stream chunks.
 *
 * Order within a chunk batch: thinking, then visible text, then tool_use(s),
 * matching the order Vibe composes an assistant message (think → text → calls).
 * Tool results arrive on their own `role: "tool"` lines.
 */
export function mapVibeEventToChunks(
  event: VibeStreamEvent,
  state: VibeStreamState,
  index = 0,
): StreamChunk[] {
  const chunks: StreamChunk[] = [];

  if (event.role === 'assistant') {
    const thinking = joinThinkParts(event.parts);
    if (thinking && !state.emittedThinking.has(thinking)) {
      state.emittedThinking.add(thinking);
      chunks.push({ type: 'thinking', content: thinking });
    }

    const text = joinTextParts(event.parts);
    if (text && !state.emittedText.has(text)) {
      state.emittedText.add(text);
      chunks.push({ type: 'text', content: text });
    }

    for (const call of event.toolCalls) {
      if (state.emittedToolUse.has(call.id)) {
        continue;
      }
      state.emittedToolUse.add(call.id);
      const name = humanizeVibeTool(call.name);
      state.toolNames.set(call.id, name);
      chunks.push({ type: 'tool_use', id: call.id, name, input: call.input });
    }

    return chunks;
  }

  if (event.role === 'tool') {
    const id = toolResultId(event, index);
    if (state.emittedToolResult.has(id)) {
      return chunks;
    }
    state.emittedToolResult.add(id);
    chunks.push({
      type: 'tool_result',
      id,
      content: renderToolResult(event),
      isError: isToolResultError(event),
    });
    return chunks;
  }

  return chunks;
}

/** Extract the resume session id from a set of events, if any line carries one. */
export function extractSessionId(events: VibeStreamEvent[]): string | null {
  for (const event of events) {
    const candidate = event.raw.session_id;
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }
  return null;
}

function toolCallFromResult(event: VibeStreamEvent, fallbackIndex: number): ToolCallInfo {
  const id = toolResultId(event, fallbackIndex);
  return {
    id,
    name: 'Tool',
    input: {},
    status: isToolResultError(event) ? 'error' : 'completed',
    result: renderToolResult(event),
  };
}

/**
 * Reconstructs a conversation's chat messages from a full stream-json buffer.
 *
 * Each assistant line with visible text becomes one assistant message; its tool
 * calls attach as `toolCalls`. A following `role: "tool"` line completes the
 * matching call (by `tool_call_id`) with its result/status. `think`-only
 * assistant lines (no visible text, no calls) are dropped from history.
 */
export function streamToChatMessages(buffer: string): ChatMessage[] {
  const events = parseVibeStream(buffer);
  const messages: ChatMessage[] = [];
  const toolCallsById = new Map<string, ToolCallInfo>();
  let counter = 0;
  let resultIndex = 0;

  for (const event of events) {
    if (event.role === 'assistant') {
      const text = joinTextParts(event.parts);
      const calls: ToolCallInfo[] = event.toolCalls.map((call) => {
        const info: ToolCallInfo = {
          id: call.id,
          name: humanizeVibeTool(call.name),
          input: call.input,
          status: 'running',
        };
        toolCallsById.set(call.id, info);
        return info;
      });

      if (!text && calls.length === 0) {
        continue;
      }

      messages.push({
        id: `vibe-assistant-${counter++}`,
        role: 'assistant',
        content: text,
        timestamp: Date.now(),
        ...(calls.length > 0 ? { toolCalls: calls } : {}),
      });
      continue;
    }

    if (event.role === 'tool') {
      const id = event.toolCallId?.trim();
      const existing = id ? toolCallsById.get(id) : undefined;
      if (existing) {
        existing.status = isToolResultError(event) ? 'error' : 'completed';
        existing.result = renderToolResult(event);
        continue;
      }
      // Orphan tool result (no matching call seen): attach to the last assistant
      // message so the output is not lost.
      const last = messages[messages.length - 1];
      const info = toolCallFromResult(event, resultIndex++);
      if (last && last.role === 'assistant') {
        last.toolCalls = [...(last.toolCalls ?? []), info];
      }
    }
  }

  return messages;
}
