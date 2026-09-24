import type { ChatMessage, StreamChunk } from '../../../core/types';
import { type GrokStreamEvent, parseGrokStream } from './streamEvents';
import { grokEventHasUsage } from './usage';

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
  /** Latest `usage` or `end` object that carried a spend ledger. `end` wins. */
  usageRaw: Record<string, unknown> | null;
  /**
   * Latest per-response `usage` line since the last compaction. It is the
   * window fill; the `end` ledger sums every call of the turn.
   */
  callUsageRaw: Record<string, unknown> | null;
  /** Size Grok reported after its latest auto-compaction in this turn. */
  compactedTokens: number | null;
  /** Message from a stream `error` event, when the CLI reported one. */
  streamError: string | null;
}

/** Fresh streaming state for a new query loop. */
export function createGrokStreamState(): GrokStreamState {
  return {
    sessionId: null,
    stopReason: null,
    usageRaw: null,
    callUsageRaw: null,
    compactedTokens: null,
    streamError: null,
  };
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
    case 'usage':
      if (grokEventHasUsage(event.raw)) {
        state.usageRaw = event.raw;
        state.callUsageRaw = event.raw;
      }
      return [];
    case 'auto_compact_completed': {
      // Calls before the compaction no longer describe the window.
      state.callUsageRaw = null;
      const tokensAfter = event.raw.tokens_after;
      if (typeof tokensAfter === 'number' && Number.isFinite(tokensAfter) && tokensAfter >= 0) {
        state.compactedTokens = tokensAfter;
        return [{ type: 'context_compacted', tokensAfter }];
      }
      state.compactedTokens = null;
      return [{ type: 'context_compacted' }];
    }
    case 'end':
      if (event.sessionId && event.sessionId.trim()) {
        state.sessionId = event.sessionId.trim();
      }
      if (event.stopReason) {
        state.stopReason = event.stopReason;
      }
      if (grokEventHasUsage(event.raw)) {
        state.usageRaw = event.raw;
      }
      return [];
    case 'error': {
      const message = typeof event.raw.message === 'string' && event.raw.message.trim()
        ? event.raw.message.trim()
        : 'Grok hat einen Fehler gemeldet.';
      state.streamError = message;
      return [{ type: 'error', content: message }];
    }
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
