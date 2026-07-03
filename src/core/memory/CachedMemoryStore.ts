import { type EventRef, type Events, normalizePath,type Vault } from 'obsidian';

import { globalEventBus } from '../events/EventBus';
import { loadMemoryNotes,type MemoryNote } from './memoryService';

interface CacheEntry {
  notes: MemoryNote[];
  loadedAt: number;
}

/**
 * Soft freshness window (ms). Vault events invalidate the cache immediately when
 * memory files change; this TTL is only a belt-and-suspenders fallback for the
 * rare case an event is missed (e.g. an external sync writing outside Obsidian's
 * watcher). It bounds staleness without re-scanning the vault on every turn.
 */
const CACHE_TTL_MS = 30_000;

function isWithin(folderPath: string, filePath: string): boolean {
  const folder = `${folderPath.replace(/\/+$/, '')}/`;
  return filePath === folderPath || filePath.startsWith(folder);
}

function safeDetach(events: Events, ref: EventRef): void {
  try {
    events.offref(ref);
  } catch {
    // Some test doubles don't implement offref; fall back to off-by-callback below.
  }
}

/**
 * Caches parsed agentic-memory notes per folder so the always-on auto-recall
 * (which runs on every send) does not re-scan all vault markdown files each turn.
 *
 * Invalidation is driven by Obsidian vault events (create/modify/delete/rename)
 * scoped to the memory folder, plus the `memory:updated` event bus signal emitted
 * by the v2 AgenticMemoryService. A short TTL guards against missed events.
 *
 * Purely additive: callers that still use `loadMemoryNotes` directly keep working.
 */
export class CachedMemoryStore {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inflight = new Map<string, Promise<MemoryNote[]>>();
  private readonly refs: Array<() => void> = [];

  constructor(
    private readonly vault: Vault,
    private readonly events: Events = vault,
    private readonly ttlMs: number = CACHE_TTL_MS,
  ) {
    this.registerVaultEvent('create');
    this.registerVaultEvent('modify');
    this.registerVaultEvent('delete');
    this.registerVaultEvent('rename');
    try {
      // `memory:updated` is emitted by the v2 AgenticMemoryService on remember().
      this.refs.push(globalEventBus.on('memory:updated', () => this.invalidate()));
    } catch {
      // Event bus is optional in some test contexts; ignore.
    }
  }

  private registerVaultEvent(kind: 'create' | 'modify' | 'delete' | 'rename'): void {
    const handler = (...data: unknown[]): void => {
      const file = data[0] as { path: string } | undefined;
      const oldPath = data[1] as string | undefined;
      const touched = [file?.path, oldPath].filter((p): p is string => !!p);
      if (touched.length === 0) return;
      for (const folderKey of Array.from(this.cache.keys())) {
        if (touched.some(p => isWithin(folderKey, p))) {
          this.cache.delete(folderKey);
          this.inflight.delete(folderKey);
        }
      }
    };
    try {
      const ref = this.events.on(kind, handler);
      this.refs.push(() => safeDetach(this.events, ref));
    } catch {
      // Best-effort registration; cache still works (TTL bounds staleness).
    }
  }

  /**
   * Returns parsed memory notes for `folderPath`, hitting the cache when fresh.
   * Concurrent calls for the same folder share a single in-flight load.
   */
  async getNotes(folderPath: string): Promise<MemoryNote[]> {
    const key = normalizePath(folderPath);
    const entry = this.cache.get(key);
    if (entry && Date.now() - entry.loadedAt < this.ttlMs) {
      return entry.notes;
    }

    const existing = this.inflight.get(key);
    if (existing) {
      return existing;
    }

    const load = (async (): Promise<MemoryNote[]> => {
      try {
        const notes = await loadMemoryNotes(this.vault, key);
        this.cache.set(key, { notes, loadedAt: Date.now() });
        return notes;
      } finally {
        this.inflight.delete(key);
      }
    })();

    this.inflight.set(key, load);
    return load;
  }

  /** Force a reload on the next `getNotes` call (e.g. after settings change). */
  invalidate(folderPath?: string): void {
    if (folderPath) {
      const key = normalizePath(folderPath);
      this.cache.delete(key);
      this.inflight.delete(key);
    } else {
      this.cache.clear();
      this.inflight.clear();
    }
  }

  /** Detach all event listeners. Call on plugin unload. */
  dispose(): void {
    for (const detach of this.refs) {
      try {
        detach();
      } catch {
        // Best-effort cleanup.
      }
    }
    this.refs.length = 0;
    this.cache.clear();
    this.inflight.clear();
  }
}
