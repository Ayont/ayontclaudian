/**
 * One reading of a subagent for every surface that shows it (inline card,
 * inspector tab, swarm panel), so they never disagree about its state.
 * Pure: no DOM, no providers.
 */

import type { SubagentInfo, SubagentTimelineEntry, ToolCallInfo } from '../../../core/types';
import { getToolLabel } from '../rendering/ToolCallRenderer';

export type SubagentPhase =
  | 'starting'
  | 'running'
  | 'stopping'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'orphaned';

export const SUBAGENT_PHASE_LABELS: Readonly<Record<SubagentPhase, string>> = {
  starting: 'Startet',
  running: 'Läuft',
  stopping: 'Wird gestoppt',
  completed: 'Fertig',
  failed: 'Fehlgeschlagen',
  cancelled: 'Gestoppt',
  orphaned: 'Abgebrochen',
};

/** Entries kept per subagent; older ones fall off the front. */
export const SUBAGENT_TIMELINE_LIMIT = 160;
/** Characters kept per merged text entry; the newest text wins. */
export const SUBAGENT_TIMELINE_TEXT_LIMIT = 6_000;
const ACTIVITY_LIMIT = 160;
const FILE_LIMIT = 8;

export function resolveSubagentPhase(info: SubagentInfo): SubagentPhase {
  if (info.cancelState === 'cancelled') return 'cancelled';
  if (info.asyncStatus === 'orphaned') return 'orphaned';
  if (info.status === 'completed') return 'completed';
  if (info.status === 'error') {
    // Every provider ends a stopped agent with an error; the user's own stop
    // is not a failure.
    return info.cancelState === 'requested' ? 'cancelled' : 'failed';
  }
  if (info.cancelState === 'requested') return 'stopping';
  if (info.asyncStatus === 'pending') return 'starting';
  return 'running';
}

export function isLiveSubagentPhase(phase: SubagentPhase): boolean {
  return phase === 'starting' || phase === 'running' || phase === 'stopping';
}

export function subagentTitle(info: SubagentInfo): string {
  return info.workflowName || info.description || 'Subagent';
}

export interface SubagentActivity {
  text: string;
  /** Tool the line is about, for its icon. */
  toolName?: string;
}

function clip(text: string, limit: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > limit ? `${collapsed.slice(0, limit - 1).trimEnd()}…` : collapsed;
}

function firstLine(text: string | undefined): string {
  const line = (text ?? '').split('\n').map(part => part.trim()).find(Boolean) ?? '';
  return clip(line, ACTIVITY_LIMIT);
}

/** What the agent is doing now, or what it came back with once it is done. */
export function describeSubagentActivity(info: SubagentInfo): SubagentActivity | null {
  const phase = resolveSubagentPhase(info);
  if (!isLiveSubagentPhase(phase)) {
    const outcome = firstLine(info.result);
    return outcome ? { text: outcome, toolName: undefined } : null;
  }

  if (info.activity?.trim()) {
    return { text: clip(info.activity, ACTIVITY_LIMIT), toolName: info.lastToolName };
  }
  const running = [...info.toolCalls].reverse().find(call => call.status === 'running');
  const latest = running ?? info.toolCalls[info.toolCalls.length - 1];
  if (!latest) return null;
  return { text: clip(getToolLabel(latest.name, latest.input), ACTIVITY_LIMIT), toolName: latest.name };
}

export interface SubagentSummary {
  toolCount: number;
  failedTools: number;
  runningTools: number;
  totalTokens?: number;
  elapsedMs?: number;
  /** Files the agent read or changed, most recent last. */
  files: string[];
}

export function summarizeSubagent(info: SubagentInfo, now: number = Date.now()): SubagentSummary {
  const calls = info.toolCalls;
  const failedTools = calls.filter(call => call.status === 'error' || call.status === 'blocked').length;
  const runningTools = calls.filter(call => call.status === 'running').length;

  const files: string[] = [];
  for (const call of calls) {
    const path = touchedFile(call.input);
    if (!path) continue;
    const existing = files.indexOf(path);
    if (existing >= 0) files.splice(existing, 1);
    files.push(path);
  }

  return {
    toolCount: Math.max(calls.length, info.toolUses ?? 0),
    failedTools,
    runningTools,
    ...(info.totalTokens ? { totalTokens: info.totalTokens } : {}),
    ...(resolveElapsed(info, now) !== undefined ? { elapsedMs: resolveElapsed(info, now) } : {}),
    files: files.slice(-FILE_LIMIT),
  };
}

/** Only real file operations count; a Glob pattern or a Grep root is not a file. */
function touchedFile(input: Record<string, unknown> | undefined): string | null {
  const candidate = input?.file_path ?? input?.notebook_path;
  return typeof candidate === 'string' && candidate.trim() ? candidate : null;
}

function resolveElapsed(info: SubagentInfo, now: number): number | undefined {
  if (info.startedAt !== undefined) {
    const end = isLiveSubagentPhase(resolveSubagentPhase(info)) ? now : info.completedAt ?? now;
    return Math.max(0, end - info.startedAt);
  }
  return info.durationMs;
}

export function formatSubagentDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    return `${totalMinutes}m ${String(totalSeconds % 60).padStart(2, '0')}s`;
  }
  return `${Math.floor(totalMinutes / 60)}h ${String(totalMinutes % 60).padStart(2, '0')}m`;
}

const tokenFormat = new Intl.NumberFormat('de-DE');

export function formatSubagentTokens(tokens: number): string {
  return `${tokenFormat.format(tokens)} Tokens`;
}

/**
 * Returns a new timeline with the entry appended: consecutive text merges into
 * one entry, a tool is recorded once, and the whole stays bounded.
 */
export function appendSubagentTimeline(
  timeline: readonly SubagentTimelineEntry[] | undefined,
  entry: SubagentTimelineEntry,
): SubagentTimelineEntry[] {
  const current = timeline ?? [];
  if (entry.type === 'tool' && current.some(item => item.type === 'tool' && item.toolId === entry.toolId)) {
    return [...current];
  }

  const last = current[current.length - 1];
  if (entry.type === 'text' && last?.type === 'text') {
    const merged = `${last.text}${entry.text}`;
    const text = merged.length > SUBAGENT_TIMELINE_TEXT_LIMIT
      ? `…${merged.slice(merged.length - SUBAGENT_TIMELINE_TEXT_LIMIT + 1)}`
      : merged;
    return [...current.slice(0, -1), { ...last, text }];
  }

  const seq = (last?.seq ?? current.length - 1) + 1;
  const next = [...current, { ...entry, seq }];
  return next.length > SUBAGENT_TIMELINE_LIMIT ? next.slice(next.length - SUBAGENT_TIMELINE_LIMIT) : next;
}

export type SubagentTranscriptEntry =
  | { kind: 'prompt'; key: 'prompt'; text: string }
  | { kind: 'text'; key: string; text: string }
  | { kind: 'tool'; key: string; tool: ToolCallInfo }
  | { kind: 'result'; key: 'result'; text: string; phase: SubagentPhase };

const OUTCOME_FALLBACK: Partial<Record<SubagentPhase, string>> = {
  completed: 'Fertig.',
  failed: 'Fehlgeschlagen.',
  cancelled: 'Von dir gestoppt.',
  orphaned: 'Der Chat endete, bevor der Subagent fertig war.',
};

/**
 * The inspector's reading order: the task, then what the agent wrote and did
 * as it happened, then its outcome. Keys are stable across updates so the
 * inspector redraws in place and only new entries animate in.
 */
export function buildSubagentTranscript(info: SubagentInfo): SubagentTranscriptEntry[] {
  const entries: SubagentTranscriptEntry[] = [];
  if (info.prompt?.trim()) entries.push({ kind: 'prompt', key: 'prompt', text: info.prompt });

  const toolsById = new Map(info.toolCalls.filter(Boolean).map(call => [call.id, call]));
  const timeline = info.timeline ?? [];
  const inTimeline = new Set(timeline.flatMap(entry => (entry.type === 'tool' ? [entry.toolId] : [])));
  // Tools missing from a bounded timeline fell off its front: they are older
  // than everything still in it.
  for (const tool of toolsById.values()) {
    if (!inTimeline.has(tool.id)) entries.push({ kind: 'tool', key: `tool-${tool.id}`, tool });
  }
  const placed = new Set<string>();
  timeline.forEach((entry, index) => {
    if (entry.type === 'text') {
      const text = entry.text.trim();
      if (text) entries.push({ kind: 'text', key: `text-${entry.seq ?? index}`, text });
      return;
    }
    const tool = toolsById.get(entry.toolId);
    if (!tool || placed.has(tool.id)) return;
    placed.add(tool.id);
    entries.push({ kind: 'tool', key: `tool-${tool.id}`, tool });
  });

  const phase = resolveSubagentPhase(info);
  if (!isLiveSubagentPhase(phase)) {
    // A stopped agent's own result is the provider's interrupt notice, not an answer.
    const text = phase !== 'cancelled' && info.result?.trim() ? info.result : OUTCOME_FALLBACK[phase] ?? '';
    if (text) entries.push({ kind: 'result', key: 'result', text, phase });
  }
  return entries;
}
