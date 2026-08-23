/**
 * Projects DeepSeek Harness session records into Claudian stream chunks.
 *
 * `dsh --profile headless` prints nothing but the final assistant message, yet
 * it writes a very rich record stream into its session transcript. Verified
 * against a real 49k-record transcript (dsh 0.1.1-rc.2), these are the record
 * types it emits and what they carry:
 *
 * | record                      | carries                                      |
 * |-----------------------------|----------------------------------------------|
 * | `assistant/chunk`           | `text-delta`, `reasoning-delta`, `usage`     |
 * | `tool/code-dispatch-start`  | inner tool name + arguments                  |
 * | `tool/code-dispatch`        | inner tool result + `isError`                |
 * | `todo/write`                | the agent's todo list                        |
 * | `llm/retry`                 | provider retry with a failure code           |
 * | `compaction/start` / `/end` | context compaction                           |
 * | `session/title`             | the session's own title                      |
 * | `request/header`            | the provider + model actually used           |
 * | `turn/end`                  | why the turn ended                           |
 *
 * dsh works through a single outer `run_code` tool that internally dispatches
 * `bash` / `read` / `edit` / `write` / …; the INNER dispatches are the useful
 * unit of visibility, so those become the tool calls the chat renders. The
 * outer `tool/call` is deliberately skipped — surfacing both would show every
 * action twice.
 */

import {
  TOOL_BASH,
  TOOL_EDIT,
  TOOL_GLOB,
  TOOL_GREP,
  TOOL_READ,
  TOOL_SKILL,
  TOOL_TODO_WRITE,
  TOOL_WEB_FETCH,
  TOOL_WEB_SEARCH,
  TOOL_WRITE,
} from '../../../core/tools/toolNames';
import type { StreamChunk, UsageInfo } from '../../../core/types';

/** Inner dispatch name → Claudian's canonical tool name (real names observed). */
const DISPATCH_TOOL_NAMES: Record<string, string> = {
  bash: TOOL_BASH,
  edit: TOOL_EDIT,
  glob: TOOL_GLOB,
  grep: TOOL_GREP,
  read: TOOL_READ,
  read_image: TOOL_READ,
  skill: TOOL_SKILL,
  todo_write: TOOL_TODO_WRITE,
  web_fetch: TOOL_WEB_FETCH,
  web_search: TOOL_WEB_SEARCH,
  write: TOOL_WRITE,
};

/** Retry codes dsh reports; anything else still surfaces with its raw code. */
const RETRY_REASONS: Record<string, string> = {
  EMPTY_RESPONSE: 'leere Antwort',
  RATE_LIMIT: 'Rate-Limit',
  SERVER: 'Serverfehler',
  TIMEOUT: 'Timeout',
  TRANSPORT: 'Verbindungsfehler',
};

/** Turn-level facts recovered from the transcript, surfaced outside the stream. */
export interface DshTurnMetadata {
  model?: string;
  provider?: string;
  title?: string;
  /** Terminal reason from `turn/end`, e.g. `completed`. */
  endReason?: string;
  usage?: { inputTokens: number; outputTokens: number };
  /** Highest retry attempt seen, for the "was this turn healthy" signal. */
  retries?: number;
}

export interface DshProjection {
  chunks: StreamChunk[];
  lastSeq: number;
  metadata: DshTurnMetadata;
}

interface DshRecord {
  type?: string;
  seq?: number;
  data?: Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Flattens dsh's `content: [{type:'text', text}]` payloads into plain text. */
function flattenContent(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (!Array.isArray(value)) {
    return '';
  }
  return value
    .map((entry) => {
      const record = asRecord(entry);
      if (!record) {
        return '';
      }
      if (typeof record.text === 'string') {
        return record.text;
      }
      // `tool-result` wraps another content array one level down.
      return typeof record.content === 'undefined' ? '' : flattenContent(record.content);
    })
    .filter(Boolean)
    .join('\n');
}

function normalizeDispatchInput(
  toolName: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  // dsh already uses the same argument names Claudian's tool cards read
  // (`command`, `file_path`, `pattern`); `path` is the one exception.
  if (toolName === TOOL_READ || toolName === TOOL_WRITE || toolName === TOOL_EDIT) {
    const filePath = asString(args.file_path) ?? asString(args.path);
    return { ...args, ...(filePath ? { file_path: filePath } : {}) };
  }
  return args;
}

export function mapDshDispatchToolName(name: string | undefined): string {
  const normalized = name?.trim().toLowerCase();
  if (!normalized) {
    return 'tool';
  }
  return DISPATCH_TOOL_NAMES[normalized] ?? normalized;
}

/**
 * Projects ONE transcript line. Returns nothing for records that carry no
 * user-visible information (block framing, prune bookkeeping, the outer
 * `run_code` call, and every record at or below the watermark).
 */
export function projectDshRecord(
  line: string,
  lastSeq: number,
): { chunks: StreamChunk[]; metadata: DshTurnMetadata; seq: number } | null {
  if (!line.trim()) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }

  const record = parsed as DshRecord;
  const seq = typeof record.seq === 'number' ? record.seq : null;
  if (seq === null || seq <= lastSeq) {
    return null;
  }

  const data = asRecord(record.data) ?? {};
  const chunks: StreamChunk[] = [];
  const metadata: DshTurnMetadata = {};

  switch (record.type) {
    case 'assistant/chunk': {
      const chunk = asRecord(data.chunk);
      const chunkType = asString(chunk?.type);
      if (chunkType === 'text-delta' && typeof chunk?.text === 'string') {
        chunks.push({ type: 'text', content: chunk.text });
      } else if (chunkType === 'reasoning-delta' && typeof chunk?.text === 'string') {
        chunks.push({ type: 'thinking', content: chunk.text });
      } else if (chunkType === 'usage') {
        const usage = asRecord(chunk?.usage);
        const inputTokens = typeof usage?.inputTokens === 'number' ? usage.inputTokens : 0;
        const outputTokens = typeof usage?.outputTokens === 'number' ? usage.outputTokens : 0;
        if (inputTokens > 0 || outputTokens > 0) {
          metadata.usage = { inputTokens, outputTokens };
        }
      }
      break;
    }

    // The inner dispatch pair is what the chat renders as a tool call.
    case 'tool/code-dispatch-start': {
      const id = asString(data.subCallId);
      const name = mapDshDispatchToolName(asString(data.name));
      if (id) {
        chunks.push({
          id,
          input: normalizeDispatchInput(name, asRecord(data.arguments) ?? {}),
          name,
          type: 'tool_use',
        });
      }
      break;
    }
    case 'tool/code-dispatch': {
      const id = asString(data.subCallId);
      if (id) {
        chunks.push({
          content: flattenContent(data.content) || (data.isError === true ? 'Fehlgeschlagen' : 'Fertig'),
          id,
          ...(data.isError === true ? { isError: true } : {}),
          type: 'tool_result',
        });
      }
      break;
    }

    case 'llm/retry': {
      const failure = asRecord(data.failure);
      const code = asString(failure?.code);
      const attempt = typeof data.retry === 'number' ? data.retry : null;
      const maxRetries = typeof data.maxRetries === 'number' ? data.maxRetries : null;
      const reason = code ? RETRY_REASONS[code] ?? code : 'unbekannter Fehler';
      const counter = attempt !== null && maxRetries !== null ? ` ${attempt}/${maxRetries}` : '';
      chunks.push({
        content: `dsh wiederholt die Anfrage${counter} — ${reason}.`,
        level: 'warning',
        type: 'notice',
      });
      if (attempt !== null) {
        metadata.retries = attempt;
      }
      break;
    }

    case 'compaction/end':
      chunks.push({ type: 'context_compacted' });
      break;

    case 'request/header': {
      const config = asRecord(asRecord(data.header)?.config);
      const model = asString(config?.model);
      const provider = asString(config?.provider);
      if (model) metadata.model = model;
      if (provider) metadata.provider = provider;
      break;
    }
    case 'session/title': {
      const title = asString(data.title);
      if (title) metadata.title = title;
      break;
    }
    case 'turn/end': {
      const reason = asString(asRecord(data.reason)?.kind);
      if (reason) metadata.endReason = reason;
      break;
    }
    default:
      break;
  }

  return { chunks, metadata, seq };
}

/**
 * Projects a decompressed transcript slice. The watermark only moves forward,
 * so re-reading an overlapping slice is idempotent.
 */
export function projectDshTranscript(jsonl: string, lastSeq: number): DshProjection {
  const chunks: StreamChunk[] = [];
  const metadata: DshTurnMetadata = {};
  let watermark = lastSeq;

  for (const line of jsonl.split('\n')) {
    const projected = projectDshRecord(line, watermark);
    if (!projected) {
      continue;
    }
    watermark = projected.seq;
    chunks.push(...projected.chunks);
    Object.assign(metadata, projected.metadata);
  }

  return { chunks, lastSeq: watermark, metadata };
}

/** Builds the usage chunk from the transcript's own token counts. */
export function buildDshUsageInfo(
  metadata: DshTurnMetadata,
  contextWindow: number,
): UsageInfo | null {
  if (!metadata.usage) {
    return null;
  }

  const contextTokens = metadata.usage.inputTokens + metadata.usage.outputTokens;
  return {
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    contextTokens,
    contextWindow,
    // dsh reports real per-turn counts, so this is measured, not estimated.
    contextWindowIsAuthoritative: true,
    inputTokens: metadata.usage.inputTokens,
    outputTokens: metadata.usage.outputTokens,
    ...(metadata.model ? { model: metadata.model } : {}),
    percentage: contextWindow > 0
      ? Math.min(100, Math.max(0, Math.round((contextTokens / contextWindow) * 100)))
      : 0,
  };
}
