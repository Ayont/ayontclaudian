/**
 * One parsed server-sent event from the orchestrator bus.
 *
 * The interesting payloads are `{type:'agent', threadId, seq, event}` frames;
 * everything else (state, reachability, ...) is exposed for completeness but
 * the chat runtime filters by type.
 */
export interface FreebuffBusEvent {
  type: string;
  threadId?: string;
  seq?: number;
  event?: { type?: string; text?: string; stage?: string; metrics?: FreebuffFinishMetrics; [key: string]: unknown };
}

/** Token/context metrics carried by an agent `finish` event. */
export interface FreebuffFinishMetrics {
  context?: { usedTokens?: number; compactionThresholdTokens?: number };
  usage?: { inputTokens?: number; cachedInputTokens?: number; outputTokens?: number; totalTokens?: number };
  costUsd?: number;
}

/**
 * Incremental server-sent event parser for the orchestrator's `/api/events`
 * stream. Frames are `data: <json>` blocks separated by blank lines; `: ping`
 * comment keepalives are ignored. Feed raw chunks, collect complete events.
 */
export class FreebuffSseParser {
  private buffer = '';

  /** Feed a raw chunk; returns every event completed by it. */
  push(chunk: string): FreebuffBusEvent[] {
    this.buffer += chunk;
    const events: FreebuffBusEvent[] = [];
    let boundary = this.buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const frame = this.buffer.slice(0, boundary);
      this.buffer = this.buffer.slice(boundary + 2);
      const event = this.parseFrame(frame);
      if (event) {
        events.push(event);
      }
      boundary = this.buffer.indexOf('\n\n');
    }
    return events;
  }

  private parseFrame(frame: string): FreebuffBusEvent | null {
    for (const line of frame.split('\n')) {
      if (!line.startsWith('data:')) {
        continue;
      }
      const payload = line.slice(5).trim();
      if (!payload) {
        continue;
      }
      try {
        const parsed = JSON.parse(payload) as FreebuffBusEvent;
        if (parsed && typeof parsed.type === 'string') {
          return parsed;
        }
      } catch {
        // Malformed frame — skip rather than kill the stream.
      }
    }
    return null;
  }
}