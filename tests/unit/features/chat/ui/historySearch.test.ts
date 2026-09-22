import {
  countHistoryFilters,
  type HistorySearchEntry,
  normalizeForSearch,
  searchHistory,
} from '@/features/chat/ui/historySearch';

function entry(overrides: Partial<HistorySearchEntry> & { id: string }): HistorySearchEntry {
  return {
    title: '',
    providerId: 'claude',
    providerLabel: 'Claude',
    tag: null,
    preview: '',
    pinned: false,
    hasDraft: false,
    ...overrides,
  };
}

const entries: HistorySearchEntry[] = [
  entry({ id: 'fax', title: 'Investigate fax transmission errors C. Beuthel', tag: 'Bugfix', preview: 'Warum schlägt der Fax-Versand fehl?', text: 'SIP-Trunk meldet 488 Not Acceptable Here' }),
  entry({ id: 'fw', title: 'Implement urgent CERTUSS changes by October 1st', tag: 'Firewall', pinned: true, preview: 'FortiGate Regeln anpassen', text: 'VPN-Profil für CERTUSS exportieren' }),
  entry({ id: 'web', title: 'Review web relaunch inquiry from GF Partners', providerId: 'codex', providerLabel: 'Codex', hasDraft: true, preview: 'Grüße an das Team', text: 'Angebot für Next.js 16 Relaunch' }),
];

describe('normalizeForSearch', () => {
  it('ignores case, accents and writes ß as ss', () => {
    expect(normalizeForSearch('Grüße ÄRGER Café')).toBe('grusse arger cafe');
  });
});

describe('searchHistory', () => {
  it('returns everything in the given order for an empty query', () => {
    expect(searchHistory(entries, '   ', 'all').map(hit => hit.entry.id)).toEqual(['fax', 'fw', 'web']);
  });

  it('requires every word to match somewhere', () => {
    expect(searchHistory(entries, 'certuss vpn', 'all').map(hit => hit.entry.id)).toEqual(['fw']);
    expect(searchHistory(entries, 'certuss fax', 'all')).toEqual([]);
  });

  it('finds content that is not in the title and shows it as an excerpt', () => {
    const [hit] = searchHistory(entries, '488', 'all');

    expect(hit.entry.id).toBe('fax');
    expect(hit.snippet).toEqual({ before: 'SIP-Trunk meldet ', match: '488', after: ' Not Acceptable Here' });
  });

  it('matches across accents and keeps the original spelling in the excerpt', () => {
    const [hit] = searchHistory(entries, 'grusse', 'all');

    expect(hit.entry.id).toBe('web');
    expect(hit.snippet?.match).toBe('Grüße');
  });

  it('ranks a title match above a content-only match', () => {
    const ranked = searchHistory([
      entry({ id: 'content', title: 'Allgemeines', text: 'Wir sprechen über FortiGate.' }),
      entry({ id: 'title', title: 'FortiGate Policy prüfen' }),
    ], 'fortigate', 'all');

    expect(ranked.map(hit => hit.entry.id)).toEqual(['title', 'content']);
    expect(ranked[0].snippet).toBeNull();
  });

  it('finds chats by tag and by provider name', () => {
    expect(searchHistory(entries, 'bugfix', 'all').map(hit => hit.entry.id)).toEqual(['fax']);
    expect(searchHistory(entries, 'codex', 'all').map(hit => hit.entry.id)).toEqual(['web']);
  });

  it('applies the pinned, draft and provider filters before searching', () => {
    expect(searchHistory(entries, '', 'pinned').map(hit => hit.entry.id)).toEqual(['fw']);
    expect(searchHistory(entries, '', 'drafts').map(hit => hit.entry.id)).toEqual(['web']);
    expect(searchHistory(entries, '', 'provider:codex').map(hit => hit.entry.id)).toEqual(['web']);
    expect(searchHistory(entries, 'certuss', 'drafts')).toEqual([]);
  });

  it('cuts long excerpts around the match', () => {
    const long = `${'vorher '.repeat(40)}Treffer${' nachher'.repeat(40)}`;
    const [hit] = searchHistory([entry({ id: 'long', title: 'x', text: long })], 'treffer', 'all');

    expect(hit.snippet?.match).toBe('Treffer');
    expect(hit.snippet!.before.startsWith('…')).toBe(true);
    expect(hit.snippet!.after.endsWith('…')).toBe(true);
    expect(hit.snippet!.before.length).toBeLessThan(60);
  });
});

describe('countHistoryFilters', () => {
  it('counts pinned chats, drafts and chats per provider', () => {
    expect(countHistoryFilters(entries)).toEqual({
      all: 3,
      pinned: 1,
      drafts: 1,
      providers: [
        { providerId: 'claude', label: 'Claude', count: 2 },
        { providerId: 'codex', label: 'Codex', count: 1 },
      ],
    });
  });
});
