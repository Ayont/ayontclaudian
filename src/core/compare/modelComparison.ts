/**
 * Claudian - Model comparison ("split run")
 *
 * Runs the SAME prompt across several provider/model pairs and renders the
 * responses side by side as a Markdown note — a quick way to compare how
 * different CLIs answer. The runtime interaction is injected (`runOne`), so the
 * orchestration + formatting are pure and unit-testable.
 */

export interface ComparisonEntry {
  providerId: string;
  model: string;
  /** Human label, e.g. "Claude · Sonnet". */
  label: string;
}

export interface ComparisonOutcome {
  text: string;
  error?: string;
}

export interface ComparisonResult {
  entry: ComparisonEntry;
  text: string;
  durationMs: number;
  error?: string;
}

/**
 * Runs every entry in parallel via `runOne`, capturing text, duration and any
 * error. Never rejects — a thrown/failed run becomes a result with `error` set.
 */
export async function runModelComparison(
  entries: ComparisonEntry[],
  runOne: (entry: ComparisonEntry) => Promise<ComparisonOutcome>,
  now: () => number = () => Date.now(),
): Promise<ComparisonResult[]> {
  return Promise.all(
    entries.map(async (entry): Promise<ComparisonResult> => {
      const start = now();
      try {
        const outcome = await runOne(entry);
        return { entry, text: outcome.text, durationMs: now() - start, error: outcome.error };
      } catch (error) {
        return {
          entry,
          text: '',
          durationMs: now() - start,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

/** Renders the comparison as a Markdown note. Pure. */
export function formatComparisonMarkdown(
  prompt: string,
  results: ComparisonResult[],
  generatedAt: string = new Date().toISOString(),
): string {
  const lines: string[] = [];
  lines.push('# Modell-Vergleich');
  lines.push('');
  lines.push(`> ${generatedAt}`);
  lines.push('');
  lines.push('## Prompt');
  lines.push('');
  lines.push(prompt.trim() || '_(leer)_');
  lines.push('');

  for (const result of results) {
    lines.push(`## ${result.entry.label}`);
    lines.push('');
    lines.push(`*${formatDuration(result.durationMs)}${result.error ? ' · Fehler' : ''}*`);
    lines.push('');
    if (result.error) {
      lines.push(`> ❌ ${result.error}`);
    } else {
      lines.push(result.text.trim() || '_(keine Antwort)_');
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}
