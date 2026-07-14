import * as fs from 'node:fs';
import * as path from 'node:path';

function getPathModule(value: string): typeof path.posix {
  return value.includes('\\') || /^[A-Za-z]:/.test(value)
    ? path.win32
    : path.posix;
}

function isHostPath(pathModule: typeof path.posix): boolean {
  // Use the native path module instead of process.platform. Some test and
  // embedded runtimes override process.platform, while path.sep still reflects
  // the filesystem semantics of the running Node process.
  return path.sep === '\\'
    ? pathModule === path.win32
    : pathModule === path.posix;
}

function resolveExistingPath(value: string, pathModule: typeof path.posix): string {
  if (!isHostPath(pathModule)) {
    return pathModule.resolve(value);
  }

  const resolved = pathModule.resolve(value);
  let current = resolved;
  const missingSegments: string[] = [];

  // realpath() fails when the final file does not exist. Walk up to the
  // deepest existing ancestor so symlinks in the path are still resolved,
  // then append the missing suffix again. This closes a containment bypass
  // for paths such as trustedRoot/symlink/new-file.db.
  while (true) {
    try {
      return pathModule.resolve(fs.realpathSync.native(current), ...missingSegments);
    } catch {
      const parent = pathModule.dirname(current);
      if (parent === current) {
        return resolved;
      }
      missingSegments.unshift(pathModule.basename(current));
      current = parent;
    }
  }
}

/** Segment- and symlink-aware containment check for provider-owned paths. */
export function isPathWithinRoot(candidate: string, root: string): boolean {
  if (!candidate.trim() || !root.trim()) {
    return false;
  }

  const pathModule = getPathModule(root);
  if (getPathModule(candidate) !== pathModule) {
    return false;
  }

  const normalizedRoot = resolveExistingPath(root, pathModule);
  const normalizedCandidate = resolveExistingPath(candidate, pathModule);
  const relative = pathModule.relative(normalizedRoot, normalizedCandidate);

  return relative === '' || (
    relative !== '..'
    && !relative.startsWith(`..${pathModule.sep}`)
    && !pathModule.isAbsolute(relative)
  );
}

export function isSamePath(left: string, right: string): boolean {
  return isPathWithinRoot(left, right) && isPathWithinRoot(right, left);
}
