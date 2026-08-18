import type { InstallProgress } from '../../core/install/CliInstaller';

export type UpdateItemKind = 'plugin' | 'cli';
export type UpdateItemStatus = 'available' | 'queued' | 'running' | 'done' | 'error' | 'dismissed';

export interface UpdateOffer {
  id: string;
  kind: UpdateItemKind;
  displayName: string;
  currentVersion: string;
  latestVersion: string;
  command?: string;
}

export interface UpdateItem extends UpdateOffer {
  status: UpdateItemStatus;
  percent: number | null;
  logLines: string[];
  error?: string;
}

export interface UpdateSessionState {
  items: UpdateItem[];
}

const MAX_LOG_LINES = 40;

export function createUpdateSession(): UpdateSessionState {
  return { items: [] };
}

export function visibleItems(state: UpdateSessionState): UpdateItem[] {
  return state.items.filter((item) => item.status !== 'dismissed');
}

export function offerUpdateItems(
  state: UpdateSessionState,
  offers: readonly UpdateOffer[],
): UpdateSessionState {
  const items = [...state.items];
  for (const offer of offers) {
    const existing = items.find((item) => item.id === offer.id);
    if (existing) {
      if (existing.status === 'running' || existing.status === 'queued') {
        continue;
      }
      existing.currentVersion = offer.currentVersion;
      existing.latestVersion = offer.latestVersion;
      existing.command = offer.command;
      existing.status = 'available';
      existing.percent = null;
      existing.error = undefined;
      continue;
    }
    items.push({
      ...offer,
      status: 'available',
      percent: null,
      logLines: [],
    });
  }
  return { items };
}

/** CLI first, plugin last — a plugin reload would otherwise abort remaining CLI work. */
function queueOrder(a: UpdateItem, b: UpdateItem): number {
  if (a.kind === b.kind) {
    return 0;
  }
  return a.kind === 'cli' ? -1 : 1;
}

export function queueAllAvailable(state: UpdateSessionState): UpdateSessionState {
  const items = state.items.map((item) =>
    item.status === 'available' ? { ...item, status: 'queued' as const } : item,
  );
  items.sort(queueOrder);
  return { items };
}

export function queueOne(state: UpdateSessionState, id: string): UpdateSessionState {
  return {
    items: state.items.map((item) =>
      item.id === id && item.status === 'available' ? { ...item, status: 'queued' } : item,
    ),
  };
}

export function startNextQueued(state: UpdateSessionState): UpdateSessionState {
  if (state.items.some((item) => item.status === 'running')) {
    return state;
  }
  const next = state.items.find((item) => item.status === 'queued');
  if (!next) {
    return state;
  }
  return {
    items: state.items.map((item) =>
      item.id === next.id ? { ...item, status: 'running', percent: item.percent ?? null } : item,
    ),
  };
}

export function applyItemProgress(
  state: UpdateSessionState,
  id: string,
  progress: Pick<InstallProgress, 'phase' | 'percent' | 'line'>,
): UpdateSessionState {
  return {
    items: state.items.map((item) => {
      if (item.id !== id) {
        return item;
      }
      const logLines = progress.line
        ? [...item.logLines, progress.line].slice(-MAX_LOG_LINES)
        : item.logLines;
      return {
        ...item,
        percent: progress.percent ?? item.percent,
        logLines,
      };
    }),
  };
}

export function completeItem(
  state: UpdateSessionState,
  id: string,
  ok: boolean,
  error?: string,
): UpdateSessionState {
  return {
    items: state.items.map((item) => {
      if (item.id !== id) {
        return item;
      }
      return {
        ...item,
        status: ok ? 'done' : 'error',
        percent: ok ? 100 : item.percent,
        error: ok ? undefined : (error ?? 'Update fehlgeschlagen.'),
      };
    }),
  };
}

export function dismissItem(state: UpdateSessionState, id: string): UpdateSessionState {
  return {
    items: state.items.map((item) => {
      if (item.id !== id) {
        return item;
      }
      if (item.status === 'running' || item.status === 'queued') {
        return item;
      }
      return { ...item, status: 'dismissed' };
    }),
  };
}

export function dismissAllIdle(state: UpdateSessionState): UpdateSessionState {
  return {
    items: state.items.map((item) =>
      item.status === 'running' || item.status === 'queued'
        ? item
        : { ...item, status: 'dismissed' },
    ),
  };
}

export function describeUpdateHeadline(state: UpdateSessionState): string {
  const visible = visibleItems(state);
  if (visible.length === 0) {
    return '';
  }
  const running = visible.find((item) => item.status === 'running');
  if (running) {
    return `Aktualisiere ${running.displayName}…`;
  }
  const available = visible.filter((item) => item.status === 'available' || item.status === 'queued');
  if (available.length === 1) {
    return '1 Update bereit';
  }
  if (available.length > 1) {
    return `${available.length} Updates bereit`;
  }
  if (visible.some((item) => item.status === 'error')) {
    return 'Update fehlgeschlagen';
  }
  return 'Updates fertig';
}

export function cliUpdateItemId(providerId: string): string {
  return `cli:${providerId}`;
}

export function providerIdFromUpdateItem(id: string): string | null {
  return id.startsWith('cli:') ? id.slice(4) : null;
}
