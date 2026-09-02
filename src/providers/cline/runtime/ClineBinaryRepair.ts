import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { findCliBinaryPath } from '../../../utils/cliBinaryLocator';

const repairedMtimes = new Map<string, number>();

export function findClineCompiledBinary(command: string): string | null {
  const trimmed = command.trim();
  if (!trimmed) {
    return null;
  }
  if (!path.isAbsolute(trimmed)) {
    const resolved = findCliBinaryPath(path.basename(trimmed));
    return resolved && resolved !== trimmed ? findClineCompiledBinary(resolved) : null;
  }
  let commandPath: string;
  try {
    commandPath = fs.realpathSync(trimmed);
  } catch {
    commandPath = trimmed;
  }
  const wrapperDir = path.dirname(commandPath);
  // 1. Postinstall cache next to the Node wrapper (bin/.cline).
  const sibling = path.join(wrapperDir, '.cline');
  try {
    if (fs.existsSync(sibling) && fs.statSync(sibling).isFile()) {
      return sibling;
    }
  } catch {
    return null;
  }
  // 2. The platform package the wrapper falls back to when the cache is absent
  //    (`node_modules/@cline/cli-<platform>-<arch>/bin/cline`). This is the copy
  //    that ships with a signature macOS rejects; repairing only .cline missed it.
  const platformBinary = path.join(
    path.dirname(wrapperDir),
    'node_modules',
    '@cline',
    `cli-${process.platform}-${process.arch}`,
    'bin',
    'cline',
  );
  try {
    if (fs.existsSync(platformBinary) && fs.statSync(platformBinary).isFile()) {
      return fs.realpathSync(platformBinary);
    }
  } catch {
    return null;
  }
  return null;
}

export function buildClineCodesignRepairArgs(nativePath: string): string[] {
  return ['--force', '--sign', '-', nativePath];
}

export function buildClineQuarantineClearArgs(nativePath: string): string[] {
  return ['-d', 'com.apple.quarantine', nativePath];
}

export function shouldRetryClineSignatureKill(input: {
  alreadyRetried: boolean;
  cancelled?: boolean;
  exitCode: number | null;
  producedOutput: boolean;
}): boolean {
  if (input.alreadyRetried || input.cancelled || input.producedOutput) {
    return false;
  }
  return input.exitCode === null;
}

export function repairClineCompiledBinary(
  command: string,
  options?: { force?: boolean },
): {
  nativePath: string | null;
  repaired: boolean;
} {
  if (process.platform !== 'darwin') {
    return { nativePath: null, repaired: false };
  }

  const nativePath = findClineCompiledBinary(command);
  if (!nativePath) {
    return { nativePath: null, repaired: false };
  }

  let mtime: number;
  try {
    mtime = fs.statSync(nativePath).mtimeMs;
  } catch {
    return { nativePath, repaired: false };
  }
  if (!options?.force && repairedMtimes.get(nativePath) === mtime) {
    return { nativePath, repaired: false };
  }

  if (!options?.force) {
    const verify = spawnSync('codesign', ['--verify', nativePath], {
      encoding: 'utf8',
      timeout: 8000,
      windowsHide: true,
    });
    if (verify.status === 0) {
      repairedMtimes.set(nativePath, mtime);
      return { nativePath, repaired: false };
    }
  }

  spawnSync('xattr', buildClineQuarantineClearArgs(nativePath), {
    encoding: 'utf8',
    timeout: 8000,
    windowsHide: true,
  });

  const repair = spawnSync('codesign', buildClineCodesignRepairArgs(nativePath), {
    encoding: 'utf8',
    timeout: 20_000,
    windowsHide: true,
  });
  if (repair.status === 0) {
    try {
      repairedMtimes.set(nativePath, fs.statSync(nativePath).mtimeMs);
    } catch {
      repairedMtimes.set(nativePath, mtime);
    }
    return { nativePath, repaired: true };
  }
  return { nativePath, repaired: false };
}
