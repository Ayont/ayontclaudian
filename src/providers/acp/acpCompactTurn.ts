import type { StreamChunk, UsageInfo } from '../../core/types';

/** True when the prompt is the agent's compact command (`/compact`, Hermes `/compress`). */
export function isAcpCompactPrompt(text: string, command: string | undefined): boolean {
  if (!command) return false;
  const trimmed = text.trim().toLowerCase();
  const normalized = command.toLowerCase();
  return trimmed === normalized || trimmed.startsWith(`${normalized} `);
}

/**
 * The chunks that close an ACP turn. A compact turn gets its boundary first,
 * so the meter drops the pre-compaction fill. Its usage belongs on the meter
 * only when the agent re-measured the history afterwards (`freshFill`);
 * otherwise it describes the summarizing call and is kept as consumption.
 */
export function finishAcpTurnChunks(params: {
  compacted: boolean;
  usage: UsageInfo | null;
  sessionId: string;
  freshFill?: boolean;
}): StreamChunk[] {
  const chunks: StreamChunk[] = [];
  if (params.compacted) chunks.push({ type: 'context_compacted' });
  if (params.usage) {
    chunks.push(params.compacted && !params.freshFill
      ? { sessionId: params.sessionId, type: 'usage', usage: params.usage, contextDisplay: 'preserve' }
      : { sessionId: params.sessionId, type: 'usage', usage: params.usage });
  }
  return chunks;
}
