import type { ProviderId } from '../../../core/providers/types';
import type { AttentionReason } from '../state/types';
import type { TabId } from './types';

/** Everything one row of the tab overview shows, read from cheap in-memory state. */
export interface TabOverviewItem {
  id: TabId;
  /** 1-based position, the same number the tab bar and the go-to-tab commands use. */
  index: number;
  title: string;
  providerId: ProviderId;
  providerName: string;
  modelLabel: string | null;
  isActive: boolean;
  isStreaming: boolean;
  /** `performance.now()` at the start of the running turn. */
  streamingSince: number | null;
  attention: AttentionReason | null;
  hasDraft: boolean;
  /** Epoch ms of the last answer, or of the last change when there is none. */
  lastActivityAt: number | null;
  contextPercent: number | null;
  todos: { done: number; total: number } | null;
  runningSubagents: number;
  canClose: boolean;
  /** No conversation yet: a blank tab. */
  isEmpty: boolean;
}

export type TabStatusKind = 'streaming' | 'input' | 'failed' | 'finished' | 'draft' | 'empty' | 'idle';

export interface TabStatus {
  kind: TabStatusKind;
  label: string;
}

/** Wall clock for ages, monotonic clock for the running-turn timer. */
export interface TabClock {
  now: number;
  perfNow: number;
}

const GENERIC_TITLE = /^(new(\s*chat)?|neuer(\s*chat)?|chat\s*\d+)$/i;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function isGenericTabTitle(title: string | null | undefined): boolean {
  const trimmed = title?.trim() ?? '';
  return !trimmed || GENERIC_TITLE.test(trimmed);
}

/** Placeholder titles come from code as "New Chat"; the product speaks German. */
export function displayTabTitle(title: string | null | undefined): string {
  return isGenericTabTitle(title) ? 'Neuer Chat' : (title ?? '').trim();
}

export function composeModelLine(providerName: string, modelLabel: string | null): string {
  const model = modelLabel?.trim() ?? '';
  if (!model || model === providerName.trim()) return providerName;
  if (!providerName || model.startsWith(`${providerName} `) || model.startsWith(`${providerName}:`)) return model;
  return `${providerName} · ${model}`;
}

export function formatElapsedClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const ss = String(seconds).padStart(2, '0');
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${ss}`;
  return `${minutes}:${ss}`;
}

export function formatRelativeAgo(at: number, now: number): string {
  const elapsed = Math.max(0, now - at);
  if (elapsed < 45_000) return 'gerade eben';
  if (elapsed < HOUR) return `vor ${Math.max(1, Math.round(elapsed / MINUTE))} Min.`;
  if (elapsed < DAY) return `vor ${Math.floor(elapsed / HOUR)} Std.`;
  const days = Math.floor(elapsed / DAY);
  if (days < 7) return days === 1 ? 'vor 1 Tag' : `vor ${days} Tagen`;
  const date = new Date(at);
  return `am ${date.getDate()}.${date.getMonth() + 1}.`;
}

/** A blocking prompt outranks the running clock: the turn cannot go on without the user. */
export function resolveTabStatusKind(
  item: Pick<TabOverviewItem, 'isStreaming' | 'attention' | 'hasDraft' | 'isEmpty'>,
): TabStatusKind {
  if (item.attention === 'input') return 'input';
  if (item.isStreaming) return 'streaming';
  if (item.attention === 'failed') return 'failed';
  if (item.attention === 'finished') return 'finished';
  if (item.hasDraft) return 'draft';
  if (item.isEmpty) return 'empty';
  return 'idle';
}

export function describeTabStatus(item: TabOverviewItem, clock: TabClock): TabStatus {
  const kind = resolveTabStatusKind(item);
  const age = item.lastActivityAt !== null ? formatRelativeAgo(item.lastActivityAt, clock.now) : null;
  switch (kind) {
    case 'input':
      return { kind, label: 'Wartet auf dich' };
    case 'streaming': {
      const elapsed = item.streamingSince !== null ? clock.perfNow - item.streamingSince : 0;
      return { kind, label: `Arbeitet · ${formatElapsedClock(elapsed)}` };
    }
    case 'failed':
      return { kind, label: age ? `Fehlgeschlagen · ${age}` : 'Fehlgeschlagen' };
    case 'finished':
      return { kind, label: age ? `Neue Antwort · ${age}` : 'Neue Antwort' };
    case 'draft':
      return { kind, label: 'Entwurf' };
    case 'empty':
      return { kind, label: 'Noch leer' };
    case 'idle':
    default:
      return { kind: 'idle', label: age ? `Fertig ${age}` : 'Bereit' };
  }
}

const BADGE_STATUS_LABELS: Partial<Record<TabStatusKind, string>> = {
  input: 'Wartet auf dich',
  streaming: 'Arbeitet',
  failed: 'Fehlgeschlagen',
  finished: 'Neue Antwort',
  draft: 'Entwurf',
};

/** Tooltip form: no clock, no age, nothing for a quiet tab. */
export function describeTabBadgeStatus(
  item: Pick<TabOverviewItem, 'isStreaming' | 'attention' | 'hasDraft'>,
): string | null {
  return BADGE_STATUS_LABELS[resolveTabStatusKind({ ...item, isEmpty: false })] ?? null;
}

function foldForSearch(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export function filterTabOverviewItems(
  items: readonly TabOverviewItem[],
  query: string,
  clock: TabClock,
): TabOverviewItem[] {
  const terms = foldForSearch(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [...items];
  return items.filter((item) => {
    const haystack = foldForSearch([
      item.title,
      item.providerName,
      item.modelLabel ?? '',
      describeTabStatus(item, clock).label,
    ].join(' '));
    return terms.every((term) => haystack.includes(term));
  });
}

export function summarizeTabOverview(items: readonly TabOverviewItem[]): string {
  let working = 0;
  let waiting = 0;
  for (const item of items) {
    const kind = resolveTabStatusKind(item);
    if (kind === 'streaming') working++;
    else if (kind === 'input' || kind === 'failed' || kind === 'finished') waiting++;
  }
  const parts = [items.length === 1 ? '1 Tab' : `${items.length} Tabs`];
  if (working > 0) parts.push(working === 1 ? '1 arbeitet' : `${working} arbeiten`);
  if (waiting > 0) parts.push(waiting === 1 ? '1 wartet auf dich' : `${waiting} warten auf dich`);
  return parts.join(' · ');
}

/** Everything a row draws except time-derived text, which ticks in place. */
export function tabOverviewRowSignature(item: TabOverviewItem): string {
  return [
    item.index, item.title, item.providerId, item.providerName, item.modelLabel ?? '',
    item.isActive, item.isStreaming, item.attention ?? '', item.hasDraft,
    item.contextPercent === null ? '' : Math.round(item.contextPercent),
    item.todos ? `${item.todos.done}/${item.todos.total}` : '',
    item.runningSubagents, item.canClose, item.isEmpty,
  ].join('\u0001');
}
