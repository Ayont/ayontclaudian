import type { StreamChunk, UsageInfo } from '../../../core/types';
import { buildToolInput, canonicalToolName } from './transcript';

/**
 * Parsing for `agy --print --output-format stream-json` (verified agy 1.1.13).
 *
 * Each stdout line is one JSON event:
 *   { event: "init", conversation_id, init: { cwd, tools, permission_mode } }
 *   { event: "step_update", step_update: { step_type, state, text_delta?, usage? } }
 *   { event: "result", result: { status, response, usage } }
 */

export interface AgyStreamUsage {
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
}

export interface AgyStreamInit {
  kind: 'init';
  conversationId: string;
  tools: string[];
  permissionMode?: string;
}

export interface AgyStreamStepUpdate {
  kind: 'step_update';
  conversationId: string;
  stepIndex: number;
  state: string;
  stepType: string;
  textDelta?: string;
  durationSeconds?: number;
  usage?: AgyStreamUsage;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolOutput?: string;
}

export interface AgyStreamResult {
  kind: 'result';
  conversationId: string;
  status: string;
  response?: string;
  durationSeconds?: number;
  numTurns?: number;
  usage?: AgyStreamUsage;
}

export type AgyStreamEvent = AgyStreamInit | AgyStreamStepUpdate | AgyStreamResult;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === 'string');
}

function parseUsage(value: unknown): AgyStreamUsage | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  const inputTokens = asNumber(record.input_tokens);
  const outputTokens = asNumber(record.output_tokens);
  const thinkingTokens = asNumber(record.thinking_tokens);
  const cacheReadTokens = asNumber(record.cache_read_tokens);
  const totalTokens = asNumber(record.total_tokens);
  if (
    inputTokens === undefined
    || outputTokens === undefined
    || thinkingTokens === undefined
    || cacheReadTokens === undefined
    || totalTokens === undefined
  ) {
    return undefined;
  }
  return { inputTokens, outputTokens, thinkingTokens, cacheReadTokens, totalTokens };
}

/** Parse one NDJSON line from `agy --output-format stream-json`. */
export function parseAgyStreamLine(line: string): AgyStreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  const record = asRecord(parsed);
  if (!record) {
    return null;
  }
  const kind = asString(record.event);
  const conversationId = asString(record.conversation_id) ?? '';

  if (kind === 'init') {
    const init = asRecord(record.init) ?? {};
    return {
      kind: 'init',
      conversationId,
      tools: asStringArray(init.tools),
      permissionMode: asString(init.permission_mode),
    };
  }

  if (kind === 'step_update') {
    const step = asRecord(record.step_update);
    if (!step) {
      return null;
    }
    const toolInfo = asRecord(step.tool_info);
    const toolName = asString(step.tool_name) ?? asString(toolInfo?.name);
    const parameters = asRecord(toolInfo?.parameters) ?? {};
    return {
      kind: 'step_update',
      conversationId: asString(step.conversation_id) ?? conversationId,
      stepIndex: asNumber(step.step_index) ?? -1,
      state: asString(step.state) ?? 'DONE',
      stepType: asString(step.step_type) ?? 'unknown',
      textDelta: asString(step.text_delta),
      durationSeconds: asNumber(step.duration_seconds),
      usage: parseUsage(step.usage),
      toolName,
      toolInput: toolName
        ? buildToolInput(
            {
              stepIndex: asNumber(step.step_index) ?? -1,
              source: 'TOOL',
              type: 'TOOL_CALL',
              status: 'RUNNING',
              raw: step,
            },
            { name: toolName, args: parameters },
          )
        : undefined,
      toolOutput: asString(toolInfo?.output),
    };
  }

  if (kind === 'result') {
    const result = asRecord(record.result);
    if (!result) {
      return null;
    }
    return {
      kind: 'result',
      conversationId: asString(result.conversation_id) ?? conversationId,
      status: asString(result.status) ?? 'UNKNOWN',
      response: asString(result.response),
      durationSeconds: asNumber(result.duration_seconds),
      numTurns: asNumber(result.num_turns),
      usage: parseUsage(result.usage),
    };
  }

  return null;
}

export function usageFromAgyStream(usage: AgyStreamUsage, contextWindow: number): UsageInfo {
  const contextTokens = usage.totalTokens;
  const percentage =
    contextWindow > 0
      ? Math.min(100, Math.max(0, Math.round((contextTokens / contextWindow) * 100)))
      : 0;
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadInputTokens: usage.cacheReadTokens,
    contextTokens,
    contextWindow,
    contextWindowIsAuthoritative: false,
    percentage,
  };
}

export interface MapAgyStreamOptions {
  contextWindow?: number;
  /** Step indexes that already emitted `tool_use`, so DONE does not duplicate. */
  toolUseEmitted?: Set<number>;
}

/** Maps a parsed stream-json event onto chat stream chunks. */
export function mapAgyStreamEventToChunks(
  event: AgyStreamEvent,
  options: MapAgyStreamOptions = {},
): StreamChunk[] {
  if (event.kind === 'step_update' && event.stepType === 'tool' && event.toolName) {
    const id = `agy-stream-${event.stepIndex}`;
    const name = canonicalToolName(event.toolName) ?? event.toolName;
    const chunks: StreamChunk[] = [];
    const emitted = options.toolUseEmitted;
    if (!emitted?.has(event.stepIndex)) {
      chunks.push({ type: 'tool_use', id, name, input: event.toolInput ?? {} });
      emitted?.add(event.stepIndex);
    }
    if (event.state === 'DONE') {
      chunks.push({ type: 'tool_result', id, content: event.toolOutput ?? '' });
    }
    return chunks;
  }
  if (event.kind === 'step_update' && event.textDelta) {
    return [{ type: 'text', content: event.textDelta }];
  }
  if (event.kind === 'result' && event.usage) {
    return [
      {
        type: 'usage',
        usage: usageFromAgyStream(event.usage, options.contextWindow ?? 1_000_000),
        sessionId: event.conversationId || null,
      },
    ];
  }
  return [];
}

/** Incremental NDJSON splitter for stdout chunks. */
export function createAgyNdjsonBuffer(): {
  push: (chunk: string) => AgyStreamEvent[];
  flush: () => AgyStreamEvent[];
} {
  let pending = '';
  const take = (line: string): AgyStreamEvent | null => parseAgyStreamLine(line);

  return {
    push(chunk: string): AgyStreamEvent[] {
      pending += chunk;
      const events: AgyStreamEvent[] = [];
      let newline = pending.indexOf('\n');
      while (newline >= 0) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        const event = take(line);
        if (event) {
          events.push(event);
        }
        newline = pending.indexOf('\n');
      }
      return events;
    },
    flush(): AgyStreamEvent[] {
      const event = take(pending);
      pending = '';
      return event ? [event] : [];
    },
  };
}
