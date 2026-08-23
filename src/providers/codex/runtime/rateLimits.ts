import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** One rate-limit window as Codex reports it in its rollout transcripts. */
export interface CodexRateLimitWindow {
  usedPercent: number;
  windowMinutes: number;
  resetsAtEpochSec: number;
}

export interface CodexRateLimitSnapshot {
  windows: CodexRateLimitWindow[];
  planType?: string;
}

interface RawRateLimits {
  primary?: RawWindow | null;
  secondary?: RawWindow | null;
  plan_type?: string | null;
}

interface RawWindow {
  used_percent?: number | null;
  window_minutes?: number | null;
  resets_at?: number | null;
}

function mapRawWindow(raw: RawWindow | null | undefined): CodexRateLimitWindow | null {
  if (!raw || typeof raw.used_percent !== 'number' || typeof raw.resets_at !== 'number') {
    return null;
  }
  return {
    usedPercent: raw.used_percent,
    windowMinutes: typeof raw.window_minutes === 'number' ? raw.window_minutes : 0,
    resetsAtEpochSec: raw.resets_at,
  };
}

/** Extracts a snapshot from one JSONL line; null when the line has none.
 *  Codex nests the payload either at top level or under `payload` depending on
 *  the record type — check both before giving up. */
export function parseCodexRateLimitLine(line: string): CodexRateLimitSnapshot | null {
  if (!line.includes('rate_limits')) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  const root = parsed as { rate_limits?: RawRateLimits; payload?: { rate_limits?: RawRateLimits } };
  const raw = root.rate_limits ?? root.payload?.rate_limits;
  if (!raw) {
    return null;
  }
  const windows = [mapRawWindow(raw.primary), mapRawWindow(raw.secondary)].filter(
    (window): window is CodexRateLimitWindow => window !== null,
  );
  return { windows, planType: raw.plan_type ?? undefined };
}

/** The last line carrying a snapshot wins — transcripts are append-only. */
export function pickLatestRateLimitSnapshot(lines: string[]): CodexRateLimitSnapshot | null {
  for (let index = lines.length - 1; index >= 0; index--) {
    const snapshot = parseCodexRateLimitLine(lines[index]);
    if (snapshot && snapshot.windows.length > 0) {
      return snapshot;
    }
  }
  return null;
}

const TAIL_BYTES = 256 * 1024;

async function newestSessionFile(sessionsDir: string): Promise<string | null> {
  let newestPath: string | null = null;
  let newestMtime = 0;
  const walk = async (dir: string): Promise<void> => {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      let stats;
      try {
        stats = await stat(full);
      } catch {
        continue;
      }
      if (stats.isDirectory()) {
        await walk(full);
      } else if (stats.isFile() && entry.endsWith('.jsonl') && stats.mtimeMs > newestMtime) {
        newestPath = full;
        newestMtime = stats.mtimeMs;
      }
    }
  };
  await walk(sessionsDir);
  return newestPath;
}

/** Reads the freshest rate-limit snapshot from the newest rollout transcript.
 *  Only the file tail is parsed — snapshots repeat constantly, so the tail is
 *  guaranteed to hold the current one without loading megabytes of history. */
export async function readLatestCodexRateLimits(codexDir = join(homedir(), '.codex')): Promise<CodexRateLimitSnapshot | null> {
  const sessionsDir = join(codexDir, 'sessions');
  const file = await newestSessionFile(sessionsDir);
  if (!file) {
    return null;
  }
  let text: string;
  try {
    const handle = await readFile(file);
    const start = Math.max(0, handle.length - TAIL_BYTES);
    text = handle.subarray(start).toString('utf8');
  } catch {
    return null;
  }
  return pickLatestRateLimitSnapshot(text.split('\n'));
}