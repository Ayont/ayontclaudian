/**
 * VaultFileAdapter - Wrapper around Obsidian Vault API for file operations.
 *
 * Provides a consistent interface for file operations using Obsidian's
 * vault adapter instead of Node's fs module.
 */

import { promises as fs } from 'fs';
import type { App } from 'obsidian';

import { writeTextFileAtomic } from './atomicJsonFile';

export class VaultFileAdapter {
  private writeQueue: Promise<void> = Promise.resolve();
  private pathQueues = new Map<string, Promise<void>>();

  constructor(private app: App) {}

  async exists(path: string): Promise<boolean> {
    return this.app.vault.adapter.exists(path);
  }

  async read(path: string): Promise<string> {
    return this.app.vault.adapter.read(path);
  }

  async write(path: string, content: string): Promise<void> {
    await this.ensureParentFolder(path);
    await this.app.vault.adapter.write(path, content);
  }

  /**
   * Replaces a file in one step and serializes writes per path. An in-place
   * write cut off at quit leaves a truncated session file, and two writers of
   * one path (a tab save and background compaction) could interleave.
   */
  async writeAtomic(path: string, content: string): Promise<void> {
    const previous = this.pathQueues.get(path) ?? Promise.resolve();
    const run = async (): Promise<void> => {
      const fullPath = this.getFullPath(path);
      if (fullPath) {
        try {
          await writeTextFileAtomic(fullPath, content);
          return;
        } catch {
          // Windows can refuse the rename (EPERM/EBUSY from sync clients or
          // antivirus). A plain write beats losing the save.
        }
      }
      // Mobile adapters have no filesystem path; they get the plain write.
      await this.ensureParentFolder(path);
      await this.app.vault.adapter.write(path, content);
    };
    const result = previous.then(run, run);
    const tail = result.catch(() => undefined);
    this.pathQueues.set(path, tail);
    void tail.then(() => {
      if (this.pathQueues.get(path) === tail) this.pathQueues.delete(path);
    });
    return result;
  }

  /** Resolves once every write already queued for `path` has landed. */
  async whenWritten(path: string): Promise<void> {
    await this.pathQueues.get(path);
  }

  /**
   * Reads at most `bytes` from the start of a file, so the header of a
   * multi-megabyte session can be read without pulling the whole transcript
   * into the renderer.
   */
  async readHead(path: string, bytes: number): Promise<string> {
    const fullPath = this.getFullPath(path);
    if (!fullPath) {
      return (await this.read(path)).slice(0, bytes);
    }
    const handle = await fs.open(fullPath, 'r');
    try {
      const buffer = Buffer.alloc(bytes);
      const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
      return buffer.subarray(0, bytesRead).toString('utf8');
    } finally {
      await handle.close();
    }
  }

  async append(path: string, content: string): Promise<void> {
    await this.ensureParentFolder(path);
    const write = this.writeQueue.then(async () => {
      if (await this.exists(path)) {
        const existing = await this.read(path);
        await this.app.vault.adapter.write(path, existing + content);
      } else {
        await this.app.vault.adapter.write(path, content);
      }
    });
    // Keep the shared tail usable after a failure, but await the unrecovered
    // operation so callers and higher-level flush barriers see the write loss.
    this.writeQueue = write.catch(() => undefined);
    await write;
  }

  async delete(path: string): Promise<void> {
    if (await this.exists(path)) {
      await this.app.vault.adapter.remove(path);
    }
  }

  /** Fails silently if non-empty or missing. */
  async deleteFolder(path: string): Promise<void> {
    try {
      if (await this.exists(path)) {
        await this.app.vault.adapter.rmdir(path, false);
      }
    } catch {
      // Non-critical: directory may not be empty
    }
  }

  async listFiles(folder: string): Promise<string[]> {
    if (!(await this.exists(folder))) {
      return [];
    }
    const listing = await this.app.vault.adapter.list(folder);
    return listing.files;
  }

  /** List subfolders in a folder. Returns relative paths from the folder. */
  async listFolders(folder: string): Promise<string[]> {
    if (!(await this.exists(folder))) {
      return [];
    }
    const listing = await this.app.vault.adapter.list(folder);
    return listing.folders;
  }

  /** Recursively list all files in a folder and subfolders. */
  async listFilesRecursive(folder: string): Promise<string[]> {
    const allFiles: string[] = [];

    const processFolder = async (currentFolder: string) => {
      if (!(await this.exists(currentFolder))) return;

      const listing = await this.app.vault.adapter.list(currentFolder);
      allFiles.push(...listing.files);

      for (const subfolder of listing.folders) {
        await processFolder(subfolder);
      }
    };

    await processFolder(folder);
    return allFiles;
  }

  private getFullPath(path: string): string | null {
    const adapter = this.app.vault.adapter as { getFullPath?: (normalizedPath: string) => string };
    return typeof adapter.getFullPath === 'function' ? adapter.getFullPath(path) : null;
  }

  private async ensureParentFolder(filePath: string): Promise<void> {
    const folder = filePath.substring(0, filePath.lastIndexOf('/'));
    if (folder && !(await this.exists(folder))) {
      await this.ensureFolder(folder);
    }
  }

  /** Ensure a folder exists, creating it and parent folders if needed. */
  async ensureFolder(path: string): Promise<void> {
    if (await this.exists(path)) return;

    // Create parent folders recursively
    const parts = path.split('/').filter(Boolean);
    let current = '';
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!(await this.exists(current))) {
        await this.app.vault.adapter.mkdir(current);
      }
    }
  }

  /** Rename/move a file. */
  async rename(oldPath: string, newPath: string): Promise<void> {
    await this.app.vault.adapter.rename(oldPath, newPath);
  }

  async stat(path: string): Promise<{ mtime: number; size: number } | null> {
    try {
      const stat = await this.app.vault.adapter.stat(path);
      if (!stat) return null;
      return { mtime: stat.mtime, size: stat.size };
    } catch {
      return null;
    }
  }
}
