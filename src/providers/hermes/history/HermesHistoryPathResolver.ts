import type { ProviderHistoryPathContext } from '../../../core/providers/types';
import { isSamePath } from '../../../core/storage/pathContainment';
import { resolveExistingHermesStateDbPath, resolveHermesStateDbPath } from '../runtime/HermesPaths';

/**
 * A persisted `statePath` travels with a synced vault, so it is only trusted
 * when it resolves to this machine's Hermes home (which `HERMES_HOME` may
 * relocate). Anything else falls back to the locally configured store.
 */
export function resolveHermesStatePathHint(
  persistedPath: string | null | undefined,
  context?: ProviderHistoryPathContext,
): string | null {
  if (!context) {
    return resolveExistingHermesStateDbPath(persistedPath);
  }

  const env = context.environment;
  const hostPlatform = context.hostPlatform ?? process.platform;
  const configuredPath = resolveHermesStateDbPath(env, hostPlatform);
  const isTrustedHint = Boolean(persistedPath) && isSamePath(persistedPath!, configuredPath);

  return resolveExistingHermesStateDbPath(
    isTrustedHint ? persistedPath : undefined,
    env,
    hostPlatform,
  );
}
