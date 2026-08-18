import { type ChildProcess, spawn } from 'node:child_process';

import { getEnhancedPath } from '../../utils/env';
import { resolveProviderCliPath } from './cliDetection';
import { getCliUpdateSpec, getPreferredUpdateCommand } from './cliUpdateCatalog';
import { compareSemver, parseCliVersion } from './semver';

export interface ProviderUpdateInfo {
  providerId: string;
  displayName: string;
  currentVersion: string | null;
  latestVersion: string | null;
  updateAvailable: boolean;
  updateCommand: string | null;
}

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const cache = new Map<string, { at: number; info: ProviderUpdateInfo }>();

export function isCliUpdateAvailable(current: string | null, latest: string | null): boolean {
  return Boolean(current && latest && compareSemver(latest, current) > 0);
}

export function clearCliUpdateCache(providerId?: string): void {
  if (providerId) {
    cache.delete(providerId);
    return;
  }
  cache.clear();
}

async function readPypiVersion(pkg: string): Promise<string | null> {
  const script = [
    'import json,urllib.request',
    `print(json.load(urllib.request.urlopen("https://pypi.org/pypi/${pkg}/json", timeout=7))["info"]["version"])`,
  ].join(';');
  return readVersion('python3', ['-c', script], 8000);
}

async function readVersion(command: string, args: string[], timeoutMs: number): Promise<string | null> {
  try {
    return parseCliVersion(await runCapture(command, args, timeoutMs));
  } catch {
    return null;
  }
}

function runCapture(command: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let proc: ChildProcess;
    try {
      proc = spawn(command, args, {
        env: { ...process.env, PATH: getEnhancedPath(process.env.PATH) },
        windowsHide: true,
      });
    } catch (error) {
      reject(error instanceof Error ? error : new Error('Befehl fehlgeschlagen'));
      return;
    }

    let output = '';
    const timer = window.setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error('Zeitüberschreitung'));
    }, timeoutMs);

    const onData = (chunk: Buffer | string): void => {
      output += typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
    };
    proc.stdout?.on('data', onData);
    proc.stderr?.on('data', onData);
    proc.on('error', (error) => {
      window.clearTimeout(timer);
      reject(error);
    });
    proc.on('close', () => {
      window.clearTimeout(timer);
      resolve(output);
    });
  });
}

export async function checkProviderUpdate(
  providerId: string,
  settings: Record<string, unknown>,
  platform: NodeJS.Platform = process.platform,
): Promise<ProviderUpdateInfo | null> {
  const cached = cache.get(providerId);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.info;
  }

  const cliPath = resolveProviderCliPath(providerId, settings);
  if (!cliPath) {
    return null;
  }

  const spec = getCliUpdateSpec(providerId, cliPath);
  if (!spec) {
    return null;
  }

  const currentVersion = await readVersion(cliPath, spec.versionArgs, 5000);
  const latestVersion = spec.npmPackage
    ? await readVersion('npm', ['view', spec.npmPackage, 'version'], 8000)
    : spec.pypiPackage
      ? await readPypiVersion(spec.pypiPackage)
      : null;

  const updateAvailable = isCliUpdateAvailable(currentVersion, latestVersion);

  const info: ProviderUpdateInfo = {
    providerId,
    displayName: spec.displayName,
    currentVersion,
    latestVersion,
    updateAvailable,
    updateCommand: getPreferredUpdateCommand(providerId, platform, cliPath),
  };
  cache.set(providerId, { at: Date.now(), info });
  return info;
}

export async function checkEnabledProviderUpdates(
  enabledIds: string[],
  settings: Record<string, unknown>,
): Promise<ProviderUpdateInfo[]> {
  const results = await Promise.all(enabledIds.map((id) => checkProviderUpdate(id, settings)));
  return results.filter((info): info is ProviderUpdateInfo => Boolean(info?.updateAvailable));
}
