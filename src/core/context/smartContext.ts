export interface SmartContextCandidate {
  path: string;
  basename: string;
  score: number;
  reason: string;
  mtime?: number;
}

export interface SmartContextFile {
  path: string;
  basename: string;
  content?: string;
  mtime?: number;
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'what', 'wie', 'was', 'und', 'oder', 'der', 'die', 'das', 'ein', 'eine',
  'bitte', 'please', 'about', 'from', 'into', 'todo', 'kurz', 'mal', 'so', 'ist', 'sind', 'auf', 'für', 'von', 'den',
]);

export function tokenizeSmartContextQuery(query: string): string[] {
  const tokens = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .map(token => token.trim())
    .filter(token => token.length >= 3 && !STOPWORDS.has(token));
  return Array.from(new Set(tokens)).slice(0, 24);
}

export function rankSmartContextCandidates(
  query: string,
  files: SmartContextFile[],
  options: { limit?: number } = {},
): SmartContextCandidate[] {
  const tokens = tokenizeSmartContextQuery(query);
  if (tokens.length === 0) return [];

  return files
    .map((file): SmartContextCandidate => {
      const pathLower = file.path.toLowerCase();
      const baseLower = file.basename.toLowerCase();
      const contentLower = (file.content ?? '').toLowerCase();
      let score = 0;
      const reasons: string[] = [];

      for (const token of tokens) {
        if (baseLower.includes(token)) {
          score += baseLower.startsWith(token) ? 12 : 8;
          reasons.push(`name:${token}`);
        }
        if (pathLower.includes(token)) {
          score += 4;
          reasons.push(`path:${token}`);
        }
        const contentHits = contentLower ? contentLower.split(token).length - 1 : 0;
        if (contentHits > 0) {
          score += Math.min(6, contentHits * 1.5);
          reasons.push(`body:${token}`);
        }
      }

      if (file.mtime) {
        score += Math.min(2, Math.max(0, (Date.now() - file.mtime) / (1000 * 60 * 60 * 24 * 30)) < 1 ? 2 : 0);
      }

      return {
        path: file.path,
        basename: file.basename,
        score,
        reason: Array.from(new Set(reasons)).slice(0, 4).join(', '),
        mtime: file.mtime,
      };
    })
    .filter(candidate => candidate.score > 0)
    .sort((a, b) => b.score - a.score || (b.mtime ?? 0) - (a.mtime ?? 0) || a.path.localeCompare(b.path))
    .slice(0, options.limit ?? 5);
}

export function formatSmartContextMentions(candidates: SmartContextCandidate[]): string {
  if (candidates.length === 0) return '';
  return [
    'Relevant context:',
    ...candidates.map(candidate => `@${candidate.path}`),
  ].join('\n');
}
