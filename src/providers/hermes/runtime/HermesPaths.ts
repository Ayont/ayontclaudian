import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * Mirrors `hermes_constants._hermes_home_from_env`: `HERMES_HOME` wins,
 * otherwise the platform-native default (`%LOCALAPPDATA%\hermes` on Windows,
 * `~/.hermes` everywhere else).
 */
export function resolveHermesHome(
  env: NodeJS.ProcessEnv = process.env,
  hostPlatform: NodeJS.Platform = process.platform,
): string {
  const configuredHome = env.HERMES_HOME?.trim();
  if (configuredHome) {
    return configuredHome;
  }

  const home = env.HOME?.trim() || env.USERPROFILE?.trim() || os.homedir();
  if (hostPlatform === 'win32') {
    const localAppData = env.LOCALAPPDATA?.trim();
    const base = localAppData || path.join(home, 'AppData', 'Local');
    return path.join(base, 'hermes');
  }

  return path.join(home, '.hermes');
}

/** Path of the shared SQLite session store Hermes writes every session to. */
export function resolveHermesStateDbPath(
  env: NodeJS.ProcessEnv = process.env,
  hostPlatform: NodeJS.Platform = process.platform,
): string {
  return path.join(resolveHermesHome(env, hostPlatform), 'state.db');
}

/**
 * Prefers a persisted per-conversation hint, but only when it still exists —
 * a vault synced from another machine carries paths that are meaningless here.
 */
export function resolveExistingHermesStateDbPath(
  preferredPath?: string | null,
  env: NodeJS.ProcessEnv = process.env,
  hostPlatform: NodeJS.Platform = process.platform,
): string | null {
  const preferred = preferredPath?.trim();
  if (preferred && fs.existsSync(preferred)) {
    return preferred;
  }

  const resolved = resolveHermesStateDbPath(env, hostPlatform);
  return fs.existsSync(resolved) ? resolved : null;
}
