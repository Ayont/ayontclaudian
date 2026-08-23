import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface ClaudeUsageEvent {
  atMs: number;
  tokens: number;
}

export interface ClaudeRateWindows {
  fiveHour: { tokens: number; resetAt: number | null };
  weekly: { tokens: number };
}

/** Sums every token bucket of an assistant record; null for non-usage lines.
 *  Claude Code transcripts carry one timestamp plus usage per assistant turn. */
export function parseClaudeUsageLine(line: string): ClaudeUsageEvent | null {
  if (!line.includes('"usage"')) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  const record = parsed as { timestamp?: string; message?: { role?: string; usage?: Record<string, number> } };
  const usage = record.message?.usage;
  if (!usage || typeof record.timestamp !== 'string') {
    return null;
  }
  const atMs = Date.parse(record.timestamp);
  if (!Number.isFinite(atMs)) {
    return null;
  }
  const tokens = (usage.input_tokens ?? 0)
    + (usage.output_tokens ?? 0)
    + (usage.cache_read_input_tokens ?? 0)
    + (usage.cache_creation_input_tokens ?? 0);
  return { atMs, tokens };
}

const FIVE_HOUR_MS = 5 * 3600_000;
const SEVEN_DAY_MS = 7 * 24 * 3600_000;

/** Rolling subscription windows straight from the native transcripts:
 *  the 5h window with its reset instant plus the rolling 7 day sum. */
export function buildClaudeWindows(events: ClaudeUsageEvent[], now: number): ClaudeRateWindows {
  let fiveHourTokens = 0;
  let oldestInWindow: number | null = null;
  let weeklyTokens = 0;
  for (const event of events) {
    weeklyTokens += event.tokens;
    if (event.atMs > now - FIVE_HOUR_MS) {
      fiveHourTokens += event.tokens;
      if (oldestInWindow === null || event.atMs < oldestInWindow) {
        oldestInWindow = event.atMs;
      }
    }
  }
  const resetAt = oldestInWindow === null ? null : oldestInWindow + FIVE_HOUR_MS;
  return { fiveHour: { tokens: fiveHourTokens, resetAt }, weekly: { tokens: weeklyTokens } };
}

async function collectTranscriptFiles(projectsDir: string, sinceMs: number): Promise<string[]> {
  const files: string[] = [];
  let projects: string[];
  try {
    projects = await readdir(projectsDir);
  } catch {
    return files;
  }
  for (const project of projects) {
    const projectDir = join(projectsDir, project);
    let entries: string[];
    try {
      entries = await readdir(projectDir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith('.jsonl')) continue;
      const full = join(projectDir, entry);
      try {
        const stats = await stat(full);
        if (stats.isFile() && stats.mtimeMs >= sinceMs) {
          files.push(full);
        }
      } catch {
        continue;
      }
    }
  }
  return files;
}

/** Reads every assistant usage event of the last seven days from the native
 *  Claude Code transcripts under ~/.claude/projects. */
export async function readClaudeUsageEvents(claudeDir: string = join(homedir(), '.claude'), now: number = Date.now()): Promise<ClaudeUsageEvent[]> {
  const sinceMs = now - SEVEN_DAY_MS;
  const files = await collectTranscriptFiles(join(claudeDir, 'projects'), sinceMs);
  const events: ClaudeUsageEvent[] = [];
  for (const file of files) {
    try {
      const text = await readFile(file, 'utf8');
      for (const line of text.split('\n')) {
        const event = parseClaudeUsageLine(line);
        if (event && event.atMs >= sinceMs) {
          events.push(event);
        }
      }
    } catch {
      continue;
    }
  }
  return events;
}