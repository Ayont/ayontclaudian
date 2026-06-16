import type { ChatMessage, StreamChunk } from '../../../core/types';
import { type GrokStreamEvent, parseGrokStream } from './streamEvents';

/**
 * Maps Grok `streaming-json` delta events onto the plugin's stream + message
 * contracts. Grok streams `{type:"text"|"thought","data":…}` deltas and a
 * terminal `{type:"end","sessionId":…}`. Each line is read once by the runtime,
 * so deltas are emitted directly (no de-dup needed). The `end` event's
 * `sessionId` is captured into the state for conversation resume.
 */

/** Per-turn streaming state, threaded across stdout reads. */
export interface GrokStreamState {
  /** Resume id captured from the terminal `end` event. */
  sessionId: string | null;
  /** Stop reason captured from the terminal `end` event. */
  stopReason: string | null;
}

/** Fresh streaming state for a new query loop. */
export function createGrokStreamState(): GrokStreamState {
  return { sessionId: null, stopReason: null };
}

/**
 * Maps a single parsed stream event onto live stream chunks. `text` → a text
 * chunk, `thought` → a thinking chunk, `end` → captures the resume id (no
 * chunk). The `index` arg is unused (kept for call-site parity).
 */
export function mapGrokEventToChunks(
  event: GrokStreamEvent,
  state: GrokStreamState,
  _index = 0,
): StreamChunk[] {
  switch (event.type) {
    case 'text':
      return event.data ? [{ type: 'text', content: event.data }] : [];
    case 'thought':
      return event.data ? [{ type: 'thinking', content: event.data }] : [];
    case 'end':
      if (event.sessionId && event.sessionId.trim()) {
        state.sessionId = event.sessionId.trim();
      }
      if (event.stopReason) {
        state.stopReason = event.stopReason;
      }
      return [];
    default:
      return [];
  }
}

/** Extract the resume session id from a set of events (from the `end` event). */
export function extractSessionId(events: GrokStreamEvent[]): string | null {
  for (const event of events) {
    if (event.type === 'end' && event.sessionId && event.sessionId.trim()) {
      return event.sessionId.trim();
    }
  }
  return null;
}

/**
 * Reconstructs a conversation's chat messages from a full streaming-json buffer:
 * concatenates the `text` deltas into one assistant message. `thought` deltas
 * are reasoning and are not persisted as visible content.
 */
export function streamToChatMessages(buffer: string): ChatMessage[] {
  const events = parseGrokStream(buffer);
  const text = events
    .filter((event) => event.type === 'text' && event.data)
    .map((event) => event.data as string)
    .join('');

  if (!text) {
    return [];
  }

  return [
    {
      id: 'grok-assistant-0',
      role: 'assistant',
      content: text,
      timestamp: Date.now(),
    },
  ];
}
