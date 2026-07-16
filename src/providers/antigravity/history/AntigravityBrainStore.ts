import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * Filesystem layout helpers for the Antigravity (`agy`) CLI data directory:
 *
 *   ~/.gemini/antigravity-cli/
 *     brain/<conversationId>/.system_generated/logs/transcript.jsonl
 *
 * `agy` exposes no JSON stdout mode, so conversation discovery and the
 * structured event stream are both derived from this directory. This mirrors
 * codex's `CodexHistoryStore` (session-file discovery for the tail engine and
 * the history service).
 */

const ANTIGRAVITY_DATA_SUBDIR = path.join('.gemini', 'antigravity-cli');
const BRAIN_SUBDIR = 'brain';
const TRANSCRIPT_RELATIVE = path.join('.system_generated', 'logs', 'transcript.jsonl');

/** Root data directory for `agy` (honors `GEMINI_HOME` if set). */
export function getAntigravityDataDir(): string {
  const override = process.env.GEMINI_HOME?.trim();
  if (override) {
    return path.join(override, 'antigravity-cli');
  }
  return path.join(os.homedir(), ANTIGRAVITY_DATA_SUBDIR);
}

/** The `brain/` directory that contains one subdirectory per conversation. */
export function getAntigravityBrainDir(): string {
  return path.join(getAntigravityDataDir(), BRAIN_SUBDIR);
}

/** Absolute brain directory for a single conversation id. */
export function getAntigravityConversationDir(conversationId: string): string {
  return path.join(getAntigravityBrainDir(), conversationId);
}

/** Absolute transcript.jsonl path for a conversation id. */
export function getAntigravityTranscriptPath(conversationId: string): string {
  return path.join(getAntigravityConversationDir(conversationId), TRANSCRIPT_RELATIVE);
}

interface BrainEntry {
  id: string;
  mtimeMs: number;
}

function listBrainEntries(): BrainEntry[] {
  const brainDir = getAntigravityBrainDir();
  let names: string[];
  try {
    names = fs.readdirSync(brainDir);
  } catch {
    return [];
  }

  const entries: BrainEntry[] = [];
  for (const name of names) {
    const dir = path.join(brainDir, name);
    try {
      const stat = fs.statSync(dir);
      if (stat.isDirectory()) {
        entries.push({ id: name, mtimeMs: stat.mtimeMs });
      }
    } catch {
      // Skip entries that vanish mid-scan.
    }
  }
  return entries;
}

/**
 * Returns the conversation ids present before a spawn, so the runtime can
 * detect the newly created conversation id by diffing against the post-spawn
 * snapshot.
 */
export function snapshotBrainConversationIds(): Set<string> {
  return new Set(listBrainEntries().map((entry) => entry.id));
}

/**
 * Discovers the newest brain conversation id created after a spawn.
 *
 * With a `previousIds` baseline, returns ONLY a conversation absent from it (one
 * created after the snapshot), or `null` if none exists yet. It must never fall
 * back to a pre-existing conversation: doing so would lock a fresh turn onto an
 * unrelated leftover conversation (and surface its stale answer) during the
 * window before `agy` has created its new brain directory.
 *
 * Without a baseline (e.g. history listing), returns the most recently modified
 * conversation.
 */
export function discoverNewestConversationId(
  previousIds?: ReadonlySet<string>,
): string | null {
  const entries = listBrainEntries();
  if (entries.length === 0) {
    return null;
  }

  entries.sort((left, right) => right.mtimeMs - left.mtimeMs);

  if (previousIds && previousIds.size > 0) {
    const fresh = entries.find((entry) => !previousIds.has(entry.id));
    return fresh ? fresh.id : null;
  }

  return entries[0].id;
}

/**
 * Splits a transcript buffer into lines for cursor-based tailing, dropping the
 * trailing newline agy always writes. Plain `split('\n')` yields a phantom empty
 * final element, making the line count one too high — the tail cursor then
 * over-advances and silently drops the first new event of the next append (and
 * the first event of every resumed turn). Returns [] for an empty/blank buffer.
 */
export function splitTranscriptLines(buffer: string): string[] {
  const trimmed = buffer.replace(/\n+$/, '');
  return trimmed.length === 0 ? [] : trimmed.split('\n');
}

/** True when a transcript.jsonl exists for the conversation id. */
export function hasAntigravityTranscript(conversationId: string): boolean {
  try {
    return fs.statSync(getAntigravityTranscriptPath(conversationId)).isFile();
  } catch {
    return false;
  }
}

/** Reads the transcript.jsonl contents, or `null` when unavailable. */
export function readAntigravityTranscript(conversationId: string): string | null {
  try {
    return fs.readFileSync(getAntigravityTranscriptPath(conversationId), 'utf-8');
  } catch {
    return null;
  }
}

/** Stat signature of a transcript read, compared between polls to detect writes. */
export interface AntigravityTranscriptStat {
  path: string;
  size: number;
  mtimeMs: number;
}

/**
 * readAntigravityTranscript variant for the 120ms tail loop: stats
 * transcript.jsonl first and returns `null` when size+mtime still match
 * `lastStat`, so an untouched file skips the full readFileSync+split (O(1) per
 * poll instead of O(file), which made a turn O(n²) on the main thread). Any
 * stat difference — append, same-size rewrite, or truncation — forces a
 * re-read, so new content is never suppressed. The stat is captured BEFORE the
 * read: a write racing the read mismatches on the next poll and costs one extra
 * read. `path` keys the comparison, so a stat cached for another conversation
 * can never suppress this one's reads.
 */
export function readAntigravityTranscriptIfChanged(
  conversationId: string,
  lastStat: AntigravityTranscriptStat | null,
): { buffer: string | null; stat: AntigravityTranscriptStat | null } | null {
  const transcriptPath = getAntigravityTranscriptPath(conversationId);
  let stat: AntigravityTranscriptStat | null = null;
  try {
    const s = fs.statSync(transcriptPath);
    if (s.isFile()) {
      stat = { path: transcriptPath, size: s.size, mtimeMs: s.mtimeMs };
    }
  } catch {
    // Missing/unreadable — report it like readAntigravityTranscript does (null).
  }
  if (stat === null) {
    return { buffer: null, stat: null };
  }
  if (
    lastStat !== null &&
    lastStat.path === stat.path &&
    lastStat.size === stat.size &&
    lastStat.mtimeMs === stat.mtimeMs
  ) {
    return null;
  }
  const buffer = readAntigravityTranscript(conversationId);
  // Don't cache a stat for content we failed to read — retry fresh next poll.
  return { buffer, stat: buffer === null ? null : stat };
}

/** Removes a conversation's brain directory (best-effort). */
export function deleteAntigravityConversationDir(conversationId: string): void {
  const dir = getAntigravityConversationDir(conversationId);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup; never throw from history teardown.
  }
}
