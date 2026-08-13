import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { posixShellQuote } from '../runtime/ClineProcess';

export interface ClineStoredAuth {
  accountId?: string;
  authenticated: boolean;
  expiresAt?: number;
  providerId: string;
  tokenSource?: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

export function parseClineProvidersFile(raw: unknown): ClineStoredAuth[] {
  if (!isPlainObject(raw) || !isPlainObject(raw.providers)) {
    return [];
  }

  const entries: ClineStoredAuth[] = [];
  for (const [providerId, value] of Object.entries(raw.providers)) {
    if (!isPlainObject(value)) {
      continue;
    }
    const settings = isPlainObject(value.settings) ? value.settings : {};
    const auth = isPlainObject(settings.auth) ? settings.auth : {};
    const tokenSource = asString(value.tokenSource);
    const accessToken = asString(auth.accessToken);
    entries.push({
      providerId,
      authenticated: Boolean(accessToken || tokenSource === 'oauth' || tokenSource === 'manual'),
      tokenSource,
      accountId: asString(auth.accountId),
      expiresAt: typeof auth.expiresAt === 'number' ? auth.expiresAt : undefined,
    });
  }
  return entries;
}

export function readClineAuthStatus(homeDir = os.homedir()): ClineStoredAuth[] {
  const file = path.join(homeDir, '.cline', 'data', 'settings', 'providers.json');
  try {
    return parseClineProvidersFile(JSON.parse(fs.readFileSync(file, 'utf8')) as unknown);
  } catch {
    return [];
  }
}

export function formatClineAuthStatus(
  entries: ClineStoredAuth[],
  apiProvider: string,
): string {
  const match = entries.find((entry) => entry.providerId === apiProvider && entry.authenticated)
    ?? (apiProvider === 'cline-pass'
      ? entries.find((entry) => entry.providerId === 'cline' && entry.authenticated)
      : undefined);
  if (!match) {
    return 'Nicht angemeldet';
  }

  const label = apiProvider === 'cline-pass'
    ? 'ClinePass'
    : apiProvider === 'cline'
      ? 'Cline'
      : apiProvider;
  if (match.tokenSource === 'oauth') {
    return `Angemeldet bei ${label} (OAuth)`;
  }
  if (match.tokenSource === 'manual') {
    return `Angemeldet bei ${label} (Token)`;
  }
  return `Angemeldet bei ${label}`;
}

export function buildClineAuthArgs(apiProvider: string): string[] {
  if (apiProvider === 'cline' || apiProvider === 'cline-pass') {
    return ['auth', 'cline'];
  }
  return ['auth'];
}

export function buildClineAuthShellCommand(cliPath: string, apiProvider: string): string {
  return [posixShellQuote(cliPath), ...buildClineAuthArgs(apiProvider)].join(' ');
}

export function launchClineAuthInTerminal(cliPath: string, apiProvider: string): void {
  const command = buildClineAuthShellCommand(cliPath, apiProvider);
  if (process.platform === 'darwin') {
    const escaped = command.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const child = spawn('osascript', [
      '-e',
      `tell application "Terminal" to do script "${escaped}"`,
      '-e',
      'tell application "Terminal" to activate',
    ], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    return;
  }

  if (process.platform === 'win32') {
    const child = spawn('cmd.exe', [
      '/c',
      'start',
      'cmd.exe',
      '/k',
      [cliPath, ...buildClineAuthArgs(apiProvider)].join(' '),
    ], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.unref();
    return;
  }

  const child = spawn('x-terminal-emulator', ['-e', 'sh', '-lc', command], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}
