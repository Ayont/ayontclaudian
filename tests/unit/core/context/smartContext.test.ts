import {
  formatSmartContextMentions,
  rankSmartContextCandidates,
  tokenizeSmartContextQuery,
} from '@/core/context/smartContext';

describe('smartContext', () => {
  it('tokenizes meaningful query terms', () => {
    expect(tokenizeSmartContextQuery('bitte fix Kimi provider bug')).toEqual(['fix', 'kimi', 'provider', 'bug']);
  });

  it('ranks matching files by name/path/body', () => {
    const ranked = rankSmartContextCandidates('kimi provider', [
      { path: 'notes/random.md', basename: 'random', content: 'nothing' },
      { path: '02-Projekte/ayontclaudian/Kimi CLI.md', basename: 'Kimi CLI', content: 'provider setup' },
    ]);
    expect(ranked[0].path).toContain('Kimi CLI.md');
    expect(formatSmartContextMentions(ranked)).toContain('@02-Projekte/ayontclaudian/Kimi CLI.md');
  });
});
