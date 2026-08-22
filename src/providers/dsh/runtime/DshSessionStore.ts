import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * On-disk dsh session discovery.
 *
 * dsh flushes each run's transcript under
 *   $DSH_HOME/sessions/<workdir-slug>/<session-dir>/session.jsonl.zstd
 * (verified layout; slugs are mangled absolute cwds and NOT documented, so
 * discovery intentionally scans across slugs by mtime instead of recomputing
 * one). Sessions are zstd-compressed, which the plugin does not decompress —
 * the reference is for cleanup and future tooling only.
 */

export interface DshDiscoveredSession {
  /** Directory name, e.g. `session-413d3080-…`. */
  sessionId: string;
  /** Absolute session directory path. */
  dir: string;
}

/** Default DSH_HOME when no override is configured. */
export function getDshHome(): string {
  return process.env.DSH_HOME?.trim() || path.join(os.homedir(), '.dsh');
}

/**
 * Newest session directory with an mtime strictly after `notBeforeMs`, or
 * null. Never throws; a missing sessions root or stray files yield null.
 */
export function findNewestDshSessionDir(
  dshHome: string,
  notBeforeMs: number,
): DshDiscoveredSession | null {
  const sessionsRoot = path.join(dshHome, 'sessions');
  let slugs: string[];
  try {
    slugs = fs.readdirSync(sessionsRoot);
  } catch {
    return null;
  }

  let best: DshDiscoveredSession | null = null;
  let bestMtime = notBeforeMs;
  for (const slug of slugs) {
    const slugPath = path.join(sessionsRoot, slug);
    let entries: string[];
    try {
      if (!fs.statSync(slugPath).isDirectory()) {
        continue;
      }
      entries = fs.readdirSync(slugPath);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const dir = path.join(slugPath, entry);
      try {
        const stat = fs.statSync(dir);
        if (!stat.isDirectory() || stat.mtimeMs <= bestMtime) {
          continue;
        }
        bestMtime = stat.mtimeMs;
        best = { sessionId: entry, dir };
      } catch {
        // Raced deletion — skip.
      }
    }
  }
  return best;
}

/** Best-effort delete of one session directory (races tolerated). */
export function deleteDshSessionDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Already gone or locked — nothing to do.
  }
}
