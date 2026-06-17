import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * Filesystem layout helpers for the Kimi (`kimi-cli`) data directory:
 *
 *   ~/.kimi/
 *     config.toml          (models, defaults)
 *     sessions/<id>/        (per-session stream-json log files)
 *
 * Live turn events come off the CLI's stdout (`--output-format stream-json`),
 * so this store only locates the on-disk session log for HISTORY HYDRATION and
 * deletion — never for live streaming. The exact log filename inside a session
 * directory is not contractually fixed by the CLI, so `readKimiSessionLog`
 * resolves the newest NDJSON-looking file in the directory defensively.
 */

const KIMI_DATA_SUBDIR = '.kimi';
const KIMI_CODE_DATA_SUBDIR = '.kimi-code';
const SESSIONS_SUBDIR = 'sessions';
const CONFIG_FILENAME = 'config.toml';
const SESSION_LOG_EXTENSIONS = ['.jsonl', '.ndjson', '.json'];

/** Root data directory for `kimi-cli` (honors `KIMI_HOME` if set). */
export function getKimiDataDir(): string {
  const override = process.env.KIMI_HOME?.trim();
  if (override) {
    return override;
  }
  return path.join(os.homedir(), KIMI_DATA_SUBDIR);
}

/** Absolute path to `~/.kimi/config.toml`. */
export function getKimiConfigPath(): string {
  return path.join(getKimiDataDir(), CONFIG_FILENAME);
}

/**
 * Data directory for the next-gen `kimi-code` build (honors `KIMI_CODE_HOME`).
 * The modern CLI relocated its config from `~/.kimi/` to `~/.kimi-code/`.
 */
export function getKimiCodeDataDir(): string {
  const override = process.env.KIMI_CODE_HOME?.trim();
  if (override) {
    return override;
  }
  return path.join(os.homedir(), KIMI_CODE_DATA_SUBDIR);
}

/**
 * Every `config.toml` worth scanning for models/defaults, newest layout first.
 * Both the legacy `~/.kimi/` and the modern `~/.kimi-code/` directories are
 * returned so model discovery works regardless of which CLI build is installed.
 */
export function getKimiConfigPaths(): string[] {
  const paths = [
    path.join(getKimiCodeDataDir(), CONFIG_FILENAME),
    path.join(getKimiDataDir(), CONFIG_FILENAME),
  ];
  return Array.from(new Set(paths));
}

/** The `sessions/` directory that contains one subdirectory per session. */
export function getKimiSessionsDir(): string {
  return path.join(getKimiDataDir(), SESSIONS_SUBDIR);
}

/** Absolute session directory for a single session id. */
export function getKimiSessionDir(sessionId: string): string {
  return path.join(getKimiSessionsDir(), sessionId);
}

/**
 * Resolves the session log file path for an id, when present.
 *
 * Prefers a conventional `transcript.jsonl`/`messages.jsonl`, otherwise the
 * most recently modified NDJSON-looking file in the session directory. Returns
 * `null` when the directory or any log file is absent.
 */
export function getKimiSessionFilePath(sessionId: string): string | null {
  const dir = getKimiSessionDir(sessionId);
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
export function readKimiSessionLog(sessionId: string): string | null {
  const file = getKimiSessionFilePath(sessionId);
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
export function listKimiSessionIds(): string[] {
  const dir = getKimiSessionsDir();
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
export function deleteKimiSessionDir(sessionId: string): void {
  const dir = getKimiSessionDir(sessionId);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup; never throw from history teardown.
  }
}
