import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * Oh My Pi stores agent state under `~/.omp`, not under XDG data dirs.
 *
 * Verified against omp v18.2.3 with `omp config path`:
 * - default profile → `~/.omp/agent`
 * - `--profile <n>` / `OMP_PROFILE=<n>` → `~/.omp/profiles/<n>/agent`
 *
 * Session transcripts live at `<agentDir>/sessions/<cwd-slug>/<iso>_<uuid>.jsonl`.
 * The slug is NOT reconstructed here — it is an internal encoding that has
 * already proven lossy for symlinked temp dirs. Every transcript carries its own
 * `{"type":"session", ...,"cwd":"…"}` record, so the workspace is read from the
 * file instead of inferred from the directory name.
 */
export function resolveOmpHomeDir(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const home = env.HOME || env.USERPROFILE || os.homedir();
  return path.join(home, '.omp');
}

export function resolveOmpAgentDir(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const ompHome = resolveOmpHomeDir(env);
  const profile = env.OMP_PROFILE?.trim();
  return profile
    ? path.join(ompHome, 'profiles', profile, 'agent')
    : path.join(ompHome, 'agent');
}

export function resolveOmpSessionsDir(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(resolveOmpAgentDir(env), 'sessions');
}

/** Absolute paths of every session transcript omp has written, newest first. */
export function listOmpSessionFiles(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const sessionsDir = resolveOmpSessionsDir(env);
  const files: Array<{ mtimeMs: number; filePath: string }> = [];

  let workspaceDirs: string[];
  try {
    workspaceDirs = fs.readdirSync(sessionsDir);
  } catch {
    return [];
  }

  for (const workspaceDir of workspaceDirs) {
    const absoluteDir = path.join(sessionsDir, workspaceDir);
    let entries: string[];
    try {
      entries = fs.readdirSync(absoluteDir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.endsWith('.jsonl')) {
        continue;
      }
      const filePath = path.join(absoluteDir, entry);
      try {
        files.push({ filePath, mtimeMs: fs.statSync(filePath).mtimeMs });
      } catch {
        // Raced with a delete; skip.
      }
    }
  }

  return files
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .map((file) => file.filePath);
}

/**
 * Locates the transcript for one session id. The filename ends with
 * `_<sessionId>.jsonl`, so this avoids parsing every file.
 */
export function findOmpSessionFile(
  sessionId: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const trimmed = sessionId.trim();
  if (!trimmed) {
    return null;
  }

  const suffix = `_${trimmed}.jsonl`;
  return listOmpSessionFiles(env).find((filePath) => filePath.endsWith(suffix)) ?? null;
}
