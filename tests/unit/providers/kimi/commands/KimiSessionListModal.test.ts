import { buildKimiSessionRows } from '@/providers/kimi/commands/KimiSessionListModal';

jest.mock('@/providers/kimi/history/KimiSessionStore', () => ({
  listKimiSessionIds: jest.fn(),
}));

import { listKimiSessionIds } from '@/providers/kimi/history/KimiSessionStore';

describe('buildKimiSessionRows', () => {
  it('returns sessions sorted by listKimiSessionIds order', () => {
    (listKimiSessionIds as jest.Mock).mockReturnValue(['s2', 's1']);
    const rows = buildKimiSessionRows();
    expect(rows.map((r) => r.id)).toEqual(['s2', 's1']);
    expect(rows[0]).toMatchObject({ id: 's2', label: 's2' });
  });

  it('returns empty array when no sessions exist', () => {
    (listKimiSessionIds as jest.Mock).mockReturnValue([]);
    expect(buildKimiSessionRows()).toEqual([]);
  });
});
