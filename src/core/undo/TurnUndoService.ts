import { promises as fs } from 'node:fs';
import * as nodePath from 'node:path';

import { normalizePath, type TFile, type Vault } from 'obsidian';

const UNDO_ROOT = '.claudian/undo';
const MAX_TRACKED_FILE_BYTES = 2 * 1024 * 1024;
const MAX_SNAPSHOT_BYTES = 32 * 1024 * 1024;
const MAX_SNAPSHOTS = 20;
// Concurrency cap for the baseline read fan-out — high enough to hide per-read
// latency, low enough to keep the open file-descriptor count safe on big vaults.
const SNAPSHOT_READ_BATCH = 32;
const TEXT_EXTENSIONS = new Set([
  'c', 'conf', 'cpp', 'cs', 'css', 'csv', 'env', 'go', 'h', 'hpp', 'html', 'ini',
  'java', 'js', 'json', 'jsx', 'kt', 'md', 'mjs', 'php', 'properties', 'ps1', 'py',
  'rb', 'rs', 'scss', 'sh', 'sql', 'svelte', 'toml', 'ts', 'tsx', 'txt', 'vue',
  'xml', 'yaml', 'yml',
]);

export type TurnFileChangeKind = 'created' | 'modified' | 'deleted';

export interface TurnFileChange {
  path: string;
  kind: TurnFileChangeKind;
  backup?: string;
  external?: boolean;
}

export interface TurnUndoManifest {
  id: string;
  conversationId: string;
  prompt: string;
  createdAt: number;
  completedAt?: number;
  revertedAt?: number;
  changes: TurnFileChange[];
}

interface PendingSnapshot {
  manifest: TurnUndoManifest;
  before: Map<string, string>;
  externalBefore: Map<string, string>;
  externalRoots: string[];
}

function encodePath(path: string): string {
  return Buffer.from(path, 'utf8').toString('base64url');
}

function shouldTrack(file: TFile, configDir: string): boolean {
  if (file.path.startsWith('.claudian/') || file.path.startsWith(`${configDir}/`)) return false;
  return file.stat.size <= MAX_TRACKED_FILE_BYTES && TEXT_EXTENSIONS.has(file.extension.toLowerCase());
}

function shouldTrackExternal(path: string, size: number): boolean {
  const extension = nodePath.extname(path).slice(1).toLowerCase();
  return size <= MAX_TRACKED_FILE_BYTES && TEXT_EXTENSIONS.has(extension);
}

const IGNORED_EXTERNAL_FOLDERS = new Set(['.git', '.next', 'build', 'dist', 'node_modules', 'target']);

async function scanExternalRoots(roots: string[], byteLimit = MAX_SNAPSHOT_BYTES): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  let bytes = 0;
  const walk = async (folder: string): Promise<void> => {
    if (bytes >= byteLimit) return;
    const entries = await fs.readdir(folder, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (bytes >= byteLimit || entry.isSymbolicLink()) continue;
      const fullPath = nodePath.join(folder, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_EXTERNAL_FOLDERS.has(entry.name)) await walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const stat = await fs.stat(fullPath).catch(() => null);
      if (!stat || !shouldTrackExternal(fullPath, stat.size) || bytes + stat.size > byteLimit) continue;
      const content = await fs.readFile(fullPath, 'utf8').catch(() => null);
      if (content === null) continue;
      files.set(fullPath, content);
      bytes += Buffer.byteLength(content, 'utf8');
    }
  };
  for (const root of [...new Set(roots.filter(nodePath.isAbsolute))]) await walk(root);
  return files;
}

async function ensureFolder(vault: Vault, folder: string): Promise<void> {
  const adapter = vault.adapter;
  const segments = normalizePath(folder).split('/').filter(Boolean);
  let current = '';
  for (const segment of segments) {
    current = current ? `${current}/${segment}` : segment;
    if (!(await adapter.exists(current))) await adapter.mkdir(current);
  }
}

/**
 * Provider-neutral file safety net. A bounded in-memory baseline is captured
 * when a turn starts; only files that actually changed are persisted afterward.
 */
export class TurnUndoService {
  private pending = new Map<string, PendingSnapshot>();

  constructor(private readonly vault: Vault) {}

  async begin(conversationId: string, prompt: string, externalRoots: string[] = []): Promise<string> {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const before = new Map<string, string>();
    let bytes = 0;

    // Read the vault baseline in bounded-concurrency batches instead of one file
    // at a time. This snapshot sits on the critical path right before the
    // provider spawn, and a large vault previously read thousands of files
    // sequentially. Batching keeps the file descriptor count bounded while the
    // byte-budget accounting stays byte-for-byte identical: candidates are
    // consumed in the original file order and the same `bytes + stat.size` gate
    // decides inclusion.
    const trackable = this.vault.getFiles().filter((file) => shouldTrack(file, this.vault.configDir));
    for (let index = 0; index < trackable.length && bytes < MAX_SNAPSHOT_BYTES; index += SNAPSHOT_READ_BATCH) {
      const batch = trackable.slice(index, index + SNAPSHOT_READ_BATCH);
      const reads = await Promise.all(
        batch.map((file) =>
          this.vault.cachedRead(file).then(
            (content) => ({ file, content }),
            () => null, // A transiently unreadable file must not block the agent turn.
          ),
        ),
      );
      for (const read of reads) {
        if (!read || bytes + read.file.stat.size > MAX_SNAPSHOT_BYTES) continue;
        before.set(read.file.path, read.content);
        bytes += Buffer.byteLength(read.content, 'utf8');
      }
    }

    const externalBefore = await scanExternalRoots(externalRoots, Math.max(0, MAX_SNAPSHOT_BYTES - bytes));
    this.pending.set(id, {
      before,
      externalBefore,
      externalRoots: [...new Set(externalRoots.filter(nodePath.isAbsolute))],
      manifest: {
        id,
        conversationId,
        prompt: prompt.slice(0, 500),
        createdAt: Date.now(),
        changes: [],
      },
    });
    return id;
  }

  async finish(id: string): Promise<TurnUndoManifest | null> {
    const snapshot = this.pending.get(id);
    if (!snapshot) return null;
    this.pending.delete(id);

    const afterPaths = new Set<string>();
    const changes: TurnFileChange[] = [];
    const folder = `${UNDO_ROOT}/${id}`;

    for (const file of this.vault.getFiles()) {
      if (!shouldTrack(file, this.vault.configDir)) continue;
      afterPaths.add(file.path);
      const oldContent = snapshot.before.get(file.path);
      if (oldContent === undefined) {
        changes.push({ path: file.path, kind: 'created' });
        continue;
      }
      try {
        const current = await this.vault.cachedRead(file);
        if (current !== oldContent) {
          const backup = `${folder}/files/${encodePath(file.path)}.txt`;
          await ensureFolder(this.vault, `${folder}/files`);
          await this.vault.adapter.write(backup, oldContent);
          changes.push({ path: file.path, kind: 'modified', backup });
        }
      } catch {
        // Leave files that disappeared during the scan to the deletion pass.
      }
    }

    for (const [path, oldContent] of snapshot.before) {
      if (afterPaths.has(path)) continue;
      const backup = `${folder}/files/${encodePath(path)}.txt`;
      await ensureFolder(this.vault, `${folder}/files`);
      await this.vault.adapter.write(backup, oldContent);
      changes.push({ path, kind: 'deleted', backup });
    }

    const externalAfter = await scanExternalRoots(snapshot.externalRoots);
    for (const [path, current] of externalAfter) {
      const oldContent = snapshot.externalBefore.get(path);
      if (oldContent === undefined) {
        changes.push({ path, kind: 'created', external: true });
      } else if (current !== oldContent) {
        const backup = `${folder}/files/${encodePath(path)}.txt`;
        await ensureFolder(this.vault, `${folder}/files`);
        await this.vault.adapter.write(backup, oldContent);
        changes.push({ path, kind: 'modified', backup, external: true });
      }
    }
    for (const [path, oldContent] of snapshot.externalBefore) {
      if (externalAfter.has(path)) continue;
      const backup = `${folder}/files/${encodePath(path)}.txt`;
      await ensureFolder(this.vault, `${folder}/files`);
      await this.vault.adapter.write(backup, oldContent);
      changes.push({ path, kind: 'deleted', backup, external: true });
    }

    if (changes.length === 0) return { ...snapshot.manifest, completedAt: Date.now(), changes: [] };

    const manifest = { ...snapshot.manifest, completedAt: Date.now(), changes };
    await ensureFolder(this.vault, folder);
    await this.vault.adapter.write(`${folder}/manifest.json`, JSON.stringify(manifest, null, 2));
    await this.cleanup();
    return manifest;
  }

  async list(): Promise<TurnUndoManifest[]> {
    if (!(await this.vault.adapter.exists(UNDO_ROOT))) return [];
    const listing = await this.vault.adapter.list(UNDO_ROOT);
    const manifests: TurnUndoManifest[] = [];
    for (const folder of listing.folders) {
      try {
        manifests.push(JSON.parse(await this.vault.adapter.read(`${folder}/manifest.json`)) as TurnUndoManifest);
      } catch {
        // Ignore interrupted/corrupt snapshots.
      }
    }
    return manifests.sort((a, b) => b.createdAt - a.createdAt);
  }

  async revertLatest(conversationId?: string): Promise<TurnUndoManifest | null> {
    const latest = (await this.list()).find((item) => !item.revertedAt && (!conversationId || item.conversationId === conversationId));
    if (!latest) return null;

    for (const change of [...latest.changes].reverse()) {
      if (change.external) {
        if (change.kind === 'created') {
          await fs.rm(change.path, { force: true });
        } else if (change.backup) {
          await fs.mkdir(nodePath.dirname(change.path), { recursive: true });
          await fs.writeFile(change.path, await this.vault.adapter.read(change.backup), 'utf8');
        }
        continue;
      }
      if (change.kind === 'created') {
        if (await this.vault.adapter.exists(change.path)) await this.vault.adapter.remove(change.path);
        continue;
      }
      if (!change.backup) continue;
      const oldContent = await this.vault.adapter.read(change.backup);
      const parent = change.path.includes('/') ? change.path.slice(0, change.path.lastIndexOf('/')) : '';
      if (parent) await ensureFolder(this.vault, parent);
      await this.vault.adapter.write(change.path, oldContent);
    }

    latest.revertedAt = Date.now();
    await this.vault.adapter.write(`${UNDO_ROOT}/${latest.id}/manifest.json`, JSON.stringify(latest, null, 2));
    return latest;
  }

  private async cleanup(): Promise<void> {
    const snapshots = await this.list();
    for (const stale of snapshots.slice(MAX_SNAPSHOTS)) {
      const folder = `${UNDO_ROOT}/${stale.id}`;
      const listing = await this.vault.adapter.list(folder).catch(() => ({ files: [], folders: [] }));
      for (const child of listing.folders) {
        const nested = await this.vault.adapter.list(child).catch(() => ({ files: [], folders: [] }));
        for (const file of nested.files) await this.vault.adapter.remove(file).catch(() => undefined);
        await this.vault.adapter.rmdir(child, true).catch(() => undefined);
      }
      for (const file of listing.files) await this.vault.adapter.remove(file).catch(() => undefined);
      await this.vault.adapter.rmdir(folder, true).catch(() => undefined);
    }
  }
}
