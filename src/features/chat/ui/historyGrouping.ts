export type HistoryRecencyGroup = 'pinned' | 'today' | 'yesterday' | 'week' | 'older';

export const HISTORY_GROUP_LABELS: Record<HistoryRecencyGroup, string> = {
  pinned: 'Angepinnt',
  today: 'Heute',
  yesterday: 'Gestern',
  week: 'Diese Woche',
  older: 'Älter',
};

const GROUP_ORDER: readonly HistoryRecencyGroup[] = [
  'pinned',
  'today',
  'yesterday',
  'week',
  'older',
];

export function startOfLocalDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function getHistoryRecencyGroup(
  timestamp: number,
  now: Date,
  pinned = false,
): HistoryRecencyGroup {
  if (pinned) {
    return 'pinned';
  }

  const todayStart = startOfLocalDay(now);
  const yesterdayStart = todayStart - 24 * 60 * 60 * 1000;
  const weekStart = todayStart - 6 * 24 * 60 * 60 * 1000;

  if (timestamp >= todayStart) {
    return 'today';
  }
  if (timestamp >= yesterdayStart) {
    return 'yesterday';
  }
  if (timestamp >= weekStart) {
    return 'week';
  }
  return 'older';
}

export interface HistoryGroup<T> {
  group: HistoryRecencyGroup;
  label: string;
  items: T[];
}

export function groupConversationsByRecency<T>(
  items: readonly T[],
  getTimestamp: (item: T) => number,
  isPinned: (item: T) => boolean,
  now: Date = new Date(),
): HistoryGroup<T>[] {
  const buckets = new Map<HistoryRecencyGroup, T[]>();
  for (const item of items) {
    const group = getHistoryRecencyGroup(getTimestamp(item), now, isPinned(item));
    const bucket = buckets.get(group);
    if (bucket) {
      bucket.push(item);
    } else {
      buckets.set(group, [item]);
    }
  }

  return GROUP_ORDER.flatMap((group) => {
    const grouped = buckets.get(group);
    if (!grouped || grouped.length === 0) {
      return [];
    }
    return [{ group, label: HISTORY_GROUP_LABELS[group], items: grouped }];
  });
}
