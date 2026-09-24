import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { parse as parseToml } from 'smol-toml';

/**
 * Filesystem layout helpers for the Vibe (`vibe`) data directory:
 *
 *   ~/.vibe/
 *     config.toml          (models, defaults)
 *     sessions/<id>/        (per-session stream-json log files)
 *
 * Live turn events come off the CLI's stdout (`--output-format stream-json`),
 * so this store only locates the on-disk session log for HISTORY HYDRATION and
 * deletion — never for live streaming. The exact log filename inside a session
 * directory is not contractually fixed by the CLI, so `readVibeSessionLog`
 * resolves the newest NDJSON-looking file in the directory defensively.
 *
 * vibe 2.x logs sessions elsewhere (`logs/session/session_<date>_<time>_<id8>/`
 * with meta.json + messages.jsonl); `findVibeSessionLogDir` reads the window
 * fill from there. History hydration still uses the path above: its parser does
 * not rebuild user turns from messages.jsonl yet.
 */

const VIBE_DATA_SUBDIR = '.vibe';
const SESSIONS_SUBDIR = 'sessions';
const CONFIG_FILENAME = 'config.toml';
const SESSION_LOG_EXTENSIONS = ['.jsonl', '.ndjson', '.json'];

/** Root data directory for `vibe` (honors `VIBE_HOME` if set). */
export function getVibeDataDir(): string {
  const override = process.env.VIBE_HOME?.trim();
  if (override) {
    return override;
  }
  return path.join(os.homedir(), VIBE_DATA_SUBDIR);
}

/** Absolute path to `~/.vibe/config.toml`. */
export function getVibeConfigPath(): string {
  return path.join(getVibeDataDir(), CONFIG_FILENAME);
}

/** The `sessions/` directory that contains one subdirectory per session. */
export function getVibeSessionsDir(): string {
  return path.join(getVibeDataDir(), SESSIONS_SUBDIR);
}

/** Absolute session directory for a single session id. */
export function getVibeSessionDir(sessionId: string): string {
  return path.join(getVibeSessionsDir(), sessionId);
}

/**
 * Resolves the session log file path for an id, when present.
 *
 * Prefers a conventional `transcript.jsonl`/`messages.jsonl`, otherwise the
 * most recently modified NDJSON-looking file in the session directory. Returns
 * `null` when the directory or any log file is absent.
 */
export function getVibeSessionFilePath(sessionId: string): string | null {
  const dir = getVibeSessionDir(sessionId);
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return null;
  }

  const preferred = ['transcript.jsonl', 'messages.jsonl', 'session.jsonl'];
  for (const candidate of preferred) {
    if (names.includes(candidate)) {
      return path.join(dir, candidate);
    }
  }

  const logFiles: Array<{ file: string; mtimeMs: number }> = [];
  for (const name of names) {
    const ext = path.extname(name).toLowerCase();
    if (!SESSION_LOG_EXTENSIONS.includes(ext)) {
      continue;
    }
    const file = path.join(dir, name);
    try {
      const stat = fs.statSync(file);
      if (stat.isFile()) {
        logFiles.push({ file, mtimeMs: stat.mtimeMs });
      }
    } catch {
      // Skip entries that vanish mid-scan.
    }
  }

  if (logFiles.length === 0) {
    return null;
  }
  logFiles.sort((left, right) => right.mtimeMs - left.mtimeMs);
  return logFiles[0].file;
}

/** Reads a session's stream-json log contents, or `null` when unavailable. */
export function readVibeSessionLog(sessionId: string): string | null {
  const file = getVibeSessionFilePath(sessionId);
  if (!file) {
    return null;
  }
  try {
    return fs.readFileSync(file, 'utf-8');
  } catch {
    return null;
  }
}

/** Lists session ids present on disk (most-recently-modified first). */
export function listVibeSessionIds(): string[] {
  const dir = getVibeSessionsDir();
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }

  const entries: Array<{ id: string; mtimeMs: number }> = [];
  for (const name of names) {
    const entryDir = path.join(dir, name);
    try {
      const stat = fs.statSync(entryDir);
      if (stat.isDirectory()) {
        entries.push({ id: name, mtimeMs: stat.mtimeMs });
      }
    } catch {
      // Skip entries that vanish mid-scan.
    }
  }

  entries.sort((left, right) => right.mtimeMs - left.mtimeMs);
  return entries.map((entry) => entry.id);
}

/** Removes a session's directory (best-effort; never throws). */
export function deleteVibeSessionDir(sessionId: string): void {
  const dir = getVibeSessionDir(sessionId);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup; never throw from history teardown.
  }
}

/**
 * Where vibe 2.25.8 writes its session logs: `[session_logging] save_dir` in
 * config.toml, else `VIBE_HOME/logs/session` (vibe/core/paths/_vibe_home.py).
 */
export function getVibeSessionLogRoot(): string {
  const fallback = path.join(getVibeDataDir(), 'logs', 'session');
  let raw: string;
  try {
    raw = fs.readFileSync(getVibeConfigPath(), 'utf-8');
  } catch {
    return fallback;
  }
  try {
    const config = parseToml(raw) as Record<string, unknown>;
    const logging = config.session_logging;
    const saveDir = logging && typeof logging === 'object'
      ? (logging as Record<string, unknown>).save_dir
      : undefined;
    if (typeof saveDir === 'string' && saveDir.trim()) {
      const trimmed = saveDir.trim();
      return trimmed.startsWith('~') ? path.join(os.homedir(), trimmed.slice(1)) : trimmed;
    }
  } catch {
    // An unreadable config leaves vibe on its default directory too.
  }
  return fallback;
}

function readSessionMeta(dir: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf-8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

/**
 * The log directory of one session. Vibe names it
 * `session_<date>_<time>_<first 8 id chars>` (session_interop.py); the short id
 * can repeat, so meta.json's `session_id` decides.
 */
export function findVibeSessionLogDir(sessionId: string): string | null {
  const shortId = sessionId.trim().slice(0, 8);
  if (!shortId) return null;
  const root = getVibeSessionLogRoot();
  let names: string[];
  try {
    names = fs.readdirSync(root);
  } catch {
    return null;
  }
  const candidates = names
    .filter((name) => name.startsWith('session_') && name.endsWith(`_${shortId}`))
    .map((name) => path.join(root, name));
  const exact = candidates.filter((dir) => readSessionMeta(dir)?.session_id === sessionId).sort();
  // Directory names start with the date, so the last one is the newest.
  return exact.length > 0 ? exact[exact.length - 1] : null;
}

/**
 * The window fill vibe records for a session: `stats.context_tokens`, the
 * prompt + completion of its latest model call (core/agent_loop/_loop.py).
 * 0 means "unknown" (right after a compaction, or before the first call).
 */
export function readVibeContextTokens(sessionId: string): number | null {
  const dir = findVibeSessionLogDir(sessionId);
  if (!dir) return null;
  const stats = readSessionMeta(dir)?.stats;
  if (!stats || typeof stats !== 'object') return null;
  const tokens = (stats as Record<string, unknown>).context_tokens;
  return typeof tokens === 'number' && Number.isFinite(tokens) && tokens >= 0 ? tokens : null;
}
