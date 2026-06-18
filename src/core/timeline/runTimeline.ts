import type { ProviderId } from '../providers/types';
import type { StreamChunk, UsageInfo } from '../types';

export type RunTimelineEventType =
  | 'start'
  | 'prepared'
  | 'tool_use'
  | 'tool_result'
  | 'text'
  | 'thinking'
  | 'usage'
  | 'notice'
  | 'error'
  | 'done'
  | 'finish';

export interface RunTimelineEvent {
  type: RunTimelineEventType;
  at: number;
  label: string;
  detail?: string;
  toolId?: string;
  toolName?: string;
  usage?: UsageInfo;
}

export interface RunTimeline {
  id: string;
  conversationId: string | null;
  providerId: ProviderId;
  model: string | null;
  promptPreview: string;
  startedAt: number;
  finishedAt?: number;
  durationMs?: number;
  currentNote?: string | null;
  externalContextPaths?: string[];
  events: RunTimelineEvent[];
}

export interface StartRunTimelineOptions {
  conversationId: string | null;
  providerId: ProviderId;
  model?: string | null;
  prompt: string;
  currentNote?: string | null;
  externalContextPaths?: string[];
  now?: () => number;
}

const TIMELINE_LIMIT = 30;
const timelines: RunTimeline[] = [];

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function preview(value: unknown, maxLength = 180): string {
  const text = normalizeWhitespace(typeof value === 'string' ? value : JSON.stringify(value ?? ''));
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function createId(now: number): string {
  return `run-${now}-${Math.random().toString(36).slice(2, 9)}`;
}

export function startRunTimeline(options: StartRunTimelineOptions): RunTimeline {
  const now = options.now?.() ?? Date.now();
  const timeline: RunTimeline = {
    id: createId(now),
    conversationId: options.conversationId,
    providerId: options.providerId,
    model: options.model ?? null,
    promptPreview: preview(options.prompt, 260),
    startedAt: now,
    currentNote: options.currentNote ?? null,
    externalContextPaths: options.externalContextPaths ? [...options.externalContextPaths] : undefined,
    events: [{ type: 'start', at: now, label: 'Run started' }],
  };
  timelines.push(timeline);
  while (timelines.length > TIMELINE_LIMIT) timelines.shift();
  return timeline;
}

export function recordRunTimelineEvent(
  timeline: RunTimeline | null | undefined,
  event: Omit<RunTimelineEvent, 'at'>,
  now: () => number = Date.now,
): void {
  if (!timeline) return;
  timeline.events.push({ ...event, at: now() });
}

export function recordRunTimelineChunk(
  timeline: RunTimeline | null | undefined,
  chunk: StreamChunk,
  now: () => number = Date.now,
): void {
  if (!timeline) return;
  switch (chunk.type) {
    case 'tool_use':
      recordRunTimelineEvent(timeline, {
        type: 'tool_use',
        label: `Tool use: ${chunk.name}`,
        detail: preview(chunk.input, 260),
        toolId: chunk.id,
        toolName: chunk.name,
      }, now);
      break;
    case 'tool_result':
      recordRunTimelineEvent(timeline, {
        type: 'tool_result',
        label: chunk.isError ? 'Tool result: error' : 'Tool result',
        detail: preview(chunk.content, 260),
        toolId: chunk.id,
      }, now);
      break;
    case 'text':
      recordRunTimelineEvent(timeline, { type: 'text', label: 'Text delta', detail: preview(chunk.content, 160) }, now);
      break;
    case 'thinking':
      recordRunTimelineEvent(timeline, { type: 'thinking', label: 'Thinking delta', detail: preview(chunk.content, 160) }, now);
      break;
    case 'usage':
      recordRunTimelineEvent(timeline, {
        type: 'usage',
        label: 'Usage update',
        detail: `${chunk.usage.contextTokens}/${chunk.usage.contextWindow} tokens (${chunk.usage.percentage.toFixed(1)}%)`,
        usage: chunk.usage,
      }, now);
      break;
    case 'notice':
      recordRunTimelineEvent(timeline, { type: 'notice', label: `Notice${chunk.level ? ` (${chunk.level})` : ''}`, detail: preview(chunk.content, 200) }, now);
      break;
    case 'error':
      recordRunTimelineEvent(timeline, { type: 'error', label: 'Provider error', detail: preview(chunk.content, 260) }, now);
      break;
    case 'done':
      recordRunTimelineEvent(timeline, { type: 'done', label: 'Provider done' }, now);
      break;
    case 'user_message_start':
      recordRunTimelineEvent(timeline, { type: 'prepared', label: 'Provider user message', detail: preview(chunk.content, 200) }, now);
      break;
    case 'assistant_message_start':
      recordRunTimelineEvent(timeline, { type: 'prepared', label: 'Provider assistant message' }, now);
      break;
    case 'context_compacted':
      recordRunTimelineEvent(timeline, { type: 'notice', label: 'Context compacted' }, now);
      break;
    case 'tool_output':
    case 'async_subagent_result':
    case 'subagent_tool_use':
    case 'subagent_tool_result':
      recordRunTimelineEvent(timeline, { type: 'notice', label: chunk.type, detail: preview(chunk, 220) }, now);
      break;
  }
}

export function finishRunTimeline(
  timeline: RunTimeline | null | undefined,
  status: 'success' | 'interrupted' | 'invalidated' | 'error',
  now: () => number = Date.now,
): void {
  if (!timeline || timeline.finishedAt) return;
  const finishedAt = now();
  timeline.finishedAt = finishedAt;
  timeline.durationMs = Math.max(0, finishedAt - timeline.startedAt);
  timeline.events.push({
    type: 'finish',
    at: finishedAt,
    label: `Run finished: ${status}`,
  });
}

export function getRunTimelines(): RunTimeline[] {
  return timelines.map(timeline => ({ ...timeline, events: timeline.events.map(event => ({ ...event })) }));
}

export function getLastRunTimeline(): RunTimeline | null {
  const latest = timelines.at(-1);
  return latest ? { ...latest, events: latest.events.map(event => ({ ...event })) } : null;
}

export function clearRunTimelines(): void {
  timelines.length = 0;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

function formatOffset(timeline: RunTimeline, timestamp: number): string {
  const ms = Math.max(0, timestamp - timeline.startedAt);
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function escapePipes(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, '<br>');
}

export function formatRunTimelineMarkdown(timeline: RunTimeline): string {
  const lines: string[] = [];
  lines.push('# Claudian Run Timeline');
  lines.push('');
  lines.push(`- **Run:** \`${timeline.id}\``);
  lines.push(`- **Started:** ${formatTime(timeline.startedAt)}`);
  if (timeline.finishedAt) lines.push(`- **Finished:** ${formatTime(timeline.finishedAt)}`);
  if (timeline.durationMs != null) lines.push(`- **Duration:** ${timeline.durationMs} ms`);
  lines.push(`- **Provider:** ${timeline.providerId}`);
  if (timeline.model) lines.push(`- **Model:** ${timeline.model}`);
  if (timeline.conversationId) lines.push(`- **Conversation:** \`${timeline.conversationId}\``);
  if (timeline.currentNote) lines.push(`- **Current note:** [[${timeline.currentNote}]]`);
  if (timeline.externalContextPaths?.length) {
    lines.push(`- **External contexts:** ${timeline.externalContextPaths.map(path => `\`${path}\``).join(', ')}`);
  }
  lines.push('');
  lines.push('## Prompt preview');
  lines.push('');
  lines.push('```text');
  lines.push(timeline.promptPreview);
  lines.push('```');
  lines.push('');
  lines.push('## Events');
  lines.push('');
  lines.push('| +time | Type | Event | Detail |');
  lines.push('|---:|---|---|---|');
  for (const event of timeline.events) {
    lines.push(`| ${formatOffset(timeline, event.at)} | ${event.type} | ${escapePipes(event.label)} | ${escapePipes(event.detail ?? '')} |`);
  }
  lines.push('');
  return lines.join('\n');
}
