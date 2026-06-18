import {
  type ComparisonEntry,
  type ComparisonResult,
  formatComparisonMarkdown,
  runModelComparison,
} from '@/core/compare/modelComparison';

const entries: ComparisonEntry[] = [
  { providerId: 'claude', model: 'sonnet', label: 'Claude · Sonnet' },
  { providerId: 'vibe', model: 'vibe-code', label: 'Vibe · Code' },
];

describe('runModelComparison', () => {
  it('runs all entries and captures text + duration', async () => {
    let t = 0;
    const now = () => (t += 10);
    const results = await runModelComparison(
      entries,
      async (entry) => ({ text: `answer from ${entry.providerId}` }),
      now,
    );
    expect(results).toHaveLength(2);
    expect(results[0].text).toBe('answer from claude');
    expect(results[0].durationMs).toBeGreaterThan(0);
    expect(results[0].error).toBeUndefined();
  });

  it('captures outcome errors and thrown errors without rejecting', async () => {
    const results = await runModelComparison(entries, async (entry) => {
      if (entry.providerId === 'vibe') throw new Error('boom');
      return { text: '', error: 'not ready' };
    });
    expect(results[0].error).toBe('not ready');
    expect(results[1].error).toBe('boom');
  });
});

describe('formatComparisonMarkdown', () => {
  const results: ComparisonResult[] = [
    { entry: entries[0], text: 'Hello from Claude', durationMs: 1500 },
    { entry: entries[1], text: '', durationMs: 200, error: 'timed out' },
  ];

  it('renders the prompt and one section per model', () => {
    const md = formatComparisonMarkdown('What is 2+2?', results, '2026-06-18T10:00:00.000Z');
    expect(md).toContain('# Modell-Vergleich');
    expect(md).toContain('What is 2+2?');
    expect(md).toContain('## Claude · Sonnet');
    expect(md).toContain('Hello from Claude');
    expect(md).toContain('*1.5 s*');
    expect(md).toContain('## Vibe · Code');
    expect(md).toContain('> ❌ timed out');
    expect(md).toContain('*200 ms · Fehler*');
  });
});
