import * as fs from 'fs';
import type { App } from 'obsidian';
import * as path from 'path';

import { type MemoryNote, parseMemoryNote } from '../../../core/memory/memoryService';
import { statFingerprint } from '../../../providers/desktopBridge/localTools';
import type { DesktopKnowledgeAdapters } from './desktopKnowledge';

export interface DesktopKnowledgeVaultOptions {
  app: App;
  /** Canonical actual adapter base, supplied by trusted UI, never a model. */
  vaultBase: string;
  scope: string;
  /** Exact separately user-approved configured folder; absent means denied. */
  memoryFolder?: string;
  signal: AbortSignal;
  allowed: () => boolean;
}
const fail = (): never => { throw new Error('Wissenszugriff außerhalb Freigabe oder Dateigrenzen.'); };
const identity = (s: fs.Stats) => `${s.dev}:${s.ino}`;
function lexical(value: string, memory = false): boolean {
  return !!value && value.length <= 512 && !/[\\:%]/u.test(value)
    && ![...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
    && value.split('/').every((part, i) => !!part && part !== '.' && part !== '..'
      && (!part.startsWith('.') || (memory && i === 0 && part === '.claudian'))
      && !/^(secrets?|credentials?|node_modules|Library|Keychains?|Cookies?)$/i.test(part)
      && !/\.(pem|key|p12)$/i.test(part));
}
/** Read-only, turn-local binding. Invoke only behind DesktopKnowledgeService's
 * per-operation approval. Synchronous bounded descriptor I/O avoids awaited read
 * races; it is NOT an OS sandbox or an immutable same-inode snapshot. */
export function createDesktopKnowledgeVaultAdapters(input: DesktopKnowledgeVaultOptions): DesktopKnowledgeAdapters {
  const options = Object.freeze({ ...input });
  const base = options.vaultBase;
  const basePath = () => (options.app.vault.adapter as unknown as { getBasePath(): string }).getBasePath();
  const permission = (signal: AbortSignal) => {
    if (options.signal.aborted || signal.aborted || !options.allowed() || basePath() !== base) fail();
  };
  permission(options.signal);
  if (!path.isAbsolute(base) || path.resolve(base) !== base || base === path.parse(base).root
    || !lexical(options.scope) || (options.memoryFolder !== undefined && (!lexical(options.memoryFolder, true) || options.memoryFolder === '.claudian'))) fail();
  // Reject symlink aliases in the entire absolute chain, including the root.
  const chain = (absolute: string): string[] => {
    const result: string[] = [];
    for (let current = absolute; ; current = path.dirname(current)) {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) fail();
      result.push(current);
      if (current === path.dirname(current)) break;
    }
    return result;
  };
  const baseChain = chain(base).map(p => [p, identity(fs.lstatSync(p))] as const);
  if (fs.realpathSync(base) !== base) fail();
  const roots = new Map<string, string>();
  for (const root of [options.scope, options.memoryFolder]) {
    if (!root) continue;
    const absolute = path.join(base, root);
    chain(absolute);
    roots.set(root, identity(fs.lstatSync(absolute)));
  }
  const check = (signal: AbortSignal) => {
    permission(signal);
    for (const [p, id] of baseChain) {
      const s = fs.lstatSync(p);
      if (!s.isDirectory() || s.isSymbolicLink() || identity(s) !== id) fail();
    }
    for (const [root, id] of roots) {
      const full = path.join(base, root);
      chain(full);
      if (identity(fs.lstatSync(full)) !== id) fail();
    }
  };
  const target = (file: string, root: string, signal: AbortSignal): { full: string; stat: fs.Stats } => {
    check(signal);
    if (!roots.has(root) || !lexical(file, root === options.memoryFolder)
      || !file.startsWith(root + '/') || !file.endsWith('.md')) fail();
    const full = path.join(base, file);
    chain(path.dirname(full));
    const stat = fs.lstatSync(full);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || fs.realpathSync(full) !== full) fail();
    return { full, stat };
  };
  const inventory = (signal: AbortSignal): Set<string> => {
    check(signal);
    const files = options.app.vault.getMarkdownFiles();
    check(signal);
    if (files.length > 16384) fail();
    return new Set(files.map(file => file.path));
  };
  const read = (file: string, root: string, maxUtf16: number, signal: AbortSignal, maxBytes = 65536): { text: string; mtime: number } => {
    if (!Number.isSafeInteger(maxUtf16) || maxUtf16 < 0 || maxUtf16 > 65536) fail();
    const before = target(file, root, signal);
    const cap = Math.min(maxBytes, maxUtf16 * 3, 65536);
    if (before.stat.size > cap) fail();
    check(signal);
    const fd = fs.openSync(before.full, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    try {
      check(signal);
      const opened = fs.fstatSync(fd);
      if (!opened.isFile() || opened.nlink !== 1 || opened.size > cap
        || statFingerprint(opened) !== statFingerprint(before.stat)
        || statFingerprint(target(file, root, signal).stat) !== statFingerprint(opened)) fail();
      const bytes = Buffer.alloc(cap + 1);
      let length = 0;
      while (length < bytes.length) {
        check(signal);
        const count = fs.readSync(fd, bytes, length, bytes.length - length, length);
        check(signal);
        if (!count) break;
        length += count;
      }
      const data = bytes.subarray(0, length);
      const text = data.toString('utf8');
      if (length > cap || text.length > maxUtf16 || text.includes('\0') || !Buffer.from(text).equals(data)
        || statFingerprint(fs.fstatSync(fd)) !== statFingerprint(opened)
        || statFingerprint(target(file, root, signal).stat) !== statFingerprint(opened)) fail();
      check(signal);
      return { text, mtime: opened.mtimeMs };
    } finally { fs.closeSync(fd); }
  };
  return {
    async graph(scope, maxEdges, signal) {
      check(signal);
      if (scope !== options.scope || !Number.isSafeInteger(maxEdges) || maxEdges < 0 || maxEdges > 4096) fail();
      const indexed = inventory(signal);
      const edges: [string, string][] = [];
      let visited = 0;
      const valid = (file: string) => lexical(file) && file.startsWith(scope + '/') && file.endsWith('.md') && indexed.has(file);
      const links = options.app.metadataCache.resolvedLinks;
      for (const source in links) {
        check(signal);
        if (++visited > 16384) fail();
        if (!valid(source)) continue;
        for (const destination in links[source]) {
          if (++visited > 16384) fail();
          if (!valid(destination)) continue;
          target(source, scope, signal); target(destination, scope, signal);
          if (edges.length >= maxEdges) fail();
          edges.push([source, destination]);
        }
      }
      check(signal);
      return edges;
    },
    async memories(folder, maxNotes, signal) {
      check(signal);
      if (!options.memoryFolder || folder !== options.memoryFolder || !Number.isSafeInteger(maxNotes) || maxNotes < 0 || maxNotes > 256) fail();
      const directory = fs.opendirSync(path.join(base, folder));
      const selected: string[] = [];
      let visited = 0;
      try {
        for (;;) {
          check(signal);
          const entry = directory.readSync();
          check(signal);
          if (!entry) break;
          if (++visited > 4096) fail();
          if (!entry.name.endsWith('.md')) continue;
          const file = `${folder}/${entry.name}`;
          target(file, folder, signal);
          selected.push(file);
          if (selected.length > maxNotes) fail();
        }
      } finally { directory.closeSync(); }
      // Count AND aggregate bytes checked before the first content read.
      let bytes = 0;
      for (const file of selected) { bytes += target(file, folder, signal).stat.size; if (bytes > 65536) fail(); }
      const notes: MemoryNote[] = [];
      let remaining = 65536;
      for (const file of selected.sort()) {
        const result = read(file, folder, remaining, signal, remaining);
        remaining -= Buffer.byteLength(result.text, 'utf8');
        if (result.text.trim()) notes.push(parseMemoryNote({ path: file, basename: path.basename(file, '.md'), stat: { mtime: result.mtime } }, result.text));
      }
      check(signal);
      return notes.sort((a, b) => b.mtime - a.mtime);
    },
    async readNote(file, root, maxUtf16, signal) {
      check(signal);
      if (root !== options.memoryFolder && (root !== options.scope || !inventory(signal).has(file))) fail();
      const result = read(file, root, maxUtf16, signal);
      check(signal);
      return result.text;
    },
  };
}
