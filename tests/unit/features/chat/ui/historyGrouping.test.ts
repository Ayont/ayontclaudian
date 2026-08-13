import {
  getHistoryRecencyGroup,
  groupConversationsByRecency,
  HISTORY_GROUP_LABELS,
} from '@/features/chat/ui/historyGrouping';

const NOW = new Date('2026-08-13T15:00:00');

function at(iso: string): number {
  return new Date(iso).getTime();
}

describe('getHistoryRecencyGroup', () => {
  it('classifies pinned conversations first', () => {
    expect(getHistoryRecencyGroup(at('2026-01-01T00:00:00'), NOW, true)).toBe('pinned');
  });

  it('classifies today, yesterday, this week, and older', () => {
    expect(getHistoryRecencyGroup(at('2026-08-13T09:00:00'), NOW)).toBe('today');
    expect(getHistoryRecencyGroup(at('2026-08-12T22:00:00'), NOW)).toBe('yesterday');
    expect(getHistoryRecencyGroup(at('2026-08-10T12:00:00'), NOW)).toBe('week');
    expect(getHistoryRecencyGroup(at('2026-07-01T12:00:00'), NOW)).toBe('older');
  });
});

describe('groupConversationsByRecency', () => {
  it('keeps recency order and omits empty buckets', () => {
    const items = [
      { id: 'old', ts: at('2026-06-01T00:00:00'), pinned: false },
      { id: 'pin', ts: at('2026-06-02T00:00:00'), pinned: true },
      { id: 'today', ts: at('2026-08-13T10:00:00'), pinned: false },
      { id: 'yday', ts: at('2026-08-12T10:00:00'), pinned: false },
    ];

    const groups = groupConversationsByRecency(
      items,
      (item) => item.ts,
      (item) => item.pinned,
      NOW,
    );

    expect(groups.map((group) => group.group)).toEqual(['pinned', 'today', 'yesterday', 'older']);
    expect(groups[0].label).toBe(HISTORY_GROUP_LABELS.pinned);
    expect(groups[0].items.map((item) => item.id)).toEqual(['pin']);
    expect(groups[1].items.map((item) => item.id)).toEqual(['today']);
  });

  it('preserves the incoming sort inside a bucket', () => {
    const items = [
      { id: 'newer', ts: at('2026-08-13T14:00:00'), pinned: false },
      { id: 'older-today', ts: at('2026-08-13T08:00:00'), pinned: false },
    ];

    const groups = groupConversationsByRecency(
      items,
      (item) => item.ts,
      (item) => item.pinned,
      NOW,
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].items.map((item) => item.id)).toEqual(['newer', 'older-today']);
  });
});
