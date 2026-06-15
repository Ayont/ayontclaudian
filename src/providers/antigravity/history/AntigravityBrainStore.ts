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

/** Removes a conversation's brain directory (best-effort). */
export function deleteAntigravityConversationDir(conversationId: string): void {
  const dir = getAntigravityConversationDir(conversationId);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup; never throw from history teardown.
  }
}
