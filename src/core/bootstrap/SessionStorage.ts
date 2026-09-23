import { buildConversationSearchIndex, type ConversationSearchIndex } from '../conversation/conversationSearchIndex';
import type { ProviderSessionSnapshot } from '../conversation/providerSessionHandoff';
import { ProviderRegistry } from '../providers/ProviderRegistry';
import { DEFAULT_CHAT_PROVIDER_ID } from '../providers/types';
import type { VaultFileAdapter } from '../storage/VaultFileAdapter';
import type {
  Conversation,
  ConversationMeta,
  SessionMetadata,
} from '../types';
import type { SubagentInfo } from '../types';
import { toPersistedMessages, toPersistedSubagent } from './persistedMessages';
import {
  CORRUPT_SESSIONS_PATH,
  LEGACY_SESSIONS_PATH,
  SESSIONS_INDEX_PATH,
  SESSIONS_PATH,
  TRASH_INDEX_PATH,
  TRASH_PATH,
} from './StoragePaths';

export {
  LEGACY_SESSIONS_PATH,
  SESSIONS_INDEX_PATH,
  SESSIONS_PATH,
};

/**
 * Above this, a session file is assumed to predate tool-result capping and is
 * worth rewriting. Comfortably larger than any capped conversation, so healthy
 * files are never touched.
 */
const OVERSIZED_METADATA_BYTES = 512_000;

/**
 * Background compaction must not JSON.parse files this large on the Electron
 * renderer — a 14 MB session freezes the window. Those archives compact the
 * next time the conversation is opened and saved.
 */
const MAX_BACKGROUND_COMPACT_BYTES = 2_000_000;

/** Short stable hash (FNV-1a) of a file's content, for naming its recovery copy. */
function contentHash(content: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < content.length; i += 1) {
    hash ^= content.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/** Enough for every header field of a session file; they are written first. */
const STUB_HEAD_BYTES = 16_384;

type LightSessionMetadata = SessionMetadata & {
  _messageCount?: number;
  _preview?: string;
  _lazyMessages?: boolean;
  /** Listed from the file head only; identity fields come from the full file on open. */
  _stub?: boolean;
};

export type SessionLoadResult =
  | { status: 'ok'; metadata: SessionMetadata }
  | { status: 'missing' }
  /** Present but unparsable. `backupPath` holds a byte-exact copy. */
  | { status: 'corrupt'; backupPath: string | null }
  /** Present but the read itself failed (busy, permissions). Nothing may overwrite it. */
  | { status: 'unreadable' };

export interface TrashEntry {
  id: string;
  title: string;
  providerId?: string;
  deletedAt: number;
}

/**
 * Reads one top-level field from the head of a session file. Files are written
 * pretty-printed with the header first, so a two-space-indented key is top
 * level; the compact form is accepted for files other writers produced.
 */
function readHeaderField(head: string, key: string): unknown {
  const value = '("(?:[^"\\\\]|\\\\.)*"|-?\\d+(?:\\.\\d+)?|true|false|null)';
  const match = new RegExp(`\\n  "${key}": ${value}`).exec(head)
    ?? new RegExp(`[{,]"${key}":${value}`).exec(head);
  if (!match) return undefined;
  try {
    return JSON.parse(match[1]) as unknown;
  } catch {
    return undefined;
  }
}

type LazyConversationFlags = { _lazyMessages?: boolean; _stub?: boolean; _messageCount?: number };

/** Fields a large file's listing stub reads from its head; everything else it simply does not know. */
const STUB_KNOWN_FIELDS = ['title', 'providerId', 'createdAt', 'updatedAt', 'lastResponseAt', 'sessionId', 'pinned'] as const;

/**
 * A stub never saw the full file, so its empty provider state, goal or usage
 * are gaps, not changes. Only the fields it read (or that were set on it
 * since) are laid over the stored file.
 */
function mergeStubSave(stored: SessionMetadata, next: SessionMetadata): SessionMetadata {
  const merged: SessionMetadata = { ...stored };
  for (const key of STUB_KNOWN_FIELDS) {
    if (next[key] !== undefined) {
      (merged as unknown as Record<string, unknown>)[key] = next[key];
    }
  }
  if (next.title) merged.title = next.title;
  return merged;
}

/**
 * Applies a save of a chat whose messages were never loaded onto the file on
 * disk. Header fields (title, provider state, pin, goal…) come from memory;
 * everything that only exists in the full file stays: the messages, the search
 * index built from them, and subagent data that would otherwise be rebuilt
 * from an empty message list.
 */
function mergeUnloadedSave(stored: SessionMetadata, next: SessionMetadata): SessionMetadata {
  const storedSubagents = stored.providerState?.subagentData;
  const providerState = next.providerState
    ? { ...next.providerState, ...(storedSubagents ? { subagentData: storedSubagents } : {}) }
    : undefined;
  const providerSessions = next.providerSessions
    ? Object.fromEntries(Object.entries(next.providerSessions).map(([key, snapshot]) => {
      const storedSnapshotSubagents = stored.providerSessions?.[key]?.providerState?.subagentData;
      if (!snapshot?.providerState || !storedSnapshotSubagents) return [key, snapshot];
      return [key, {
        ...snapshot,
        providerState: { ...snapshot.providerState, subagentData: storedSnapshotSubagents },
      }];
    }))
    : undefined;
  return {
    ...stored,
    ...next,
    providerState,
    providerSessions,
    messages: stored.messages,
    searchIndex: stored.searchIndex ?? next.searchIndex,
  };
}

export class SessionStorage {
  private indexCache: Map<string, SessionMetadata> | null = null;
  private indexSaveTimer: number | null = null;
  /** path → size last seen with no reclaimable slack (skip on the next pass). */
  private compactedMinimalSizes = new Map<string, number>();
  /** Bumped when a write of a path starts and when it lands, so a slow read-modify-write can see it lost the race. */
  private writeGenerations = new Map<string, number>();
  private writesInFlight = new Map<string, number>();
  private backedUpCorruptPaths = new Set<string>();
  /** Trashed while a save may still be on its way; such a late save must not bring the file back. */
  private trashedIds = new Set<string>();
  private trashIndexChain: Promise<unknown> = Promise.resolve();

  constructor(private adapter: VaultFileAdapter) {}

  getMetadataPath(id: string): string {
    return `${SESSIONS_PATH}/${id}.meta.json`;
  }

  getLegacyMetadataPath(id: string): string {
    return `${LEGACY_SESSIONS_PATH}/${id}.meta.json`;
  }

  /**
   * Resets the in-memory index cache (primarily for tests).
   */
  resetIndexCache(): void {
    this.indexCache = null;
    this.compactedMinimalSizes.clear();
    if (this.indexSaveTimer !== null) {
      const clearTimer = typeof window !== 'undefined' ? window.clearTimeout : clearTimeout;
      clearTimer(this.indexSaveTimer);
      this.indexSaveTimer = null;
    }
  }

  private scheduleIndexSave(): void {
    if (this.indexSaveTimer !== null) {
      return;
    }
    const setTimer = typeof window !== 'undefined' ? window.setTimeout : setTimeout;
    this.indexSaveTimer = setTimer(() => {
      this.indexSaveTimer = null;
      void this.persistIndex();
    }, 400) as unknown as number;
  }

  private async persistIndex(): Promise<void> {
    if (!this.indexCache) return;
    try {
      const obj: Record<string, SessionMetadata> = {};
      for (const [id, meta] of this.indexCache.entries()) {
        obj[id] = meta;
      }
      await this.writeFile(SESSIONS_INDEX_PATH, JSON.stringify(obj));
    } catch {
      // Non-fatal background cache write
    }
  }

  /** Writes a pending index save now; the debounce timer does not survive unload. */
  async flushIndex(): Promise<void> {
    if (this.indexSaveTimer === null) return;
    const clearTimer = typeof window !== 'undefined' ? window.clearTimeout : clearTimeout;
    clearTimer(this.indexSaveTimer);
    this.indexSaveTimer = null;
    await this.persistIndex();
  }

  private async writeFile(path: string, content: string): Promise<void> {
    const bump = () => this.writeGenerations.set(path, (this.writeGenerations.get(path) ?? 0) + 1);
    bump();
    this.writesInFlight.set(path, (this.writesInFlight.get(path) ?? 0) + 1);
    try {
      if (typeof this.adapter.writeAtomic === 'function') {
        await this.adapter.writeAtomic(path, content);
      } else {
        await this.adapter.write(path, content);
      }
    } finally {
      bump();
      const remaining = (this.writesInFlight.get(path) ?? 1) - 1;
      if (remaining > 0) this.writesInFlight.set(path, remaining);
      else this.writesInFlight.delete(path);
    }
  }

  /** A read-modify-write that started at `generation` may still write. */
  private isUntouchedSince(path: string, generation: number): boolean {
    return !this.writesInFlight.has(path) && (this.writeGenerations.get(path) ?? 0) === generation;
  }

  /**
   * A removed provider id (for example a leftover freebuff chat) must come back
   * as the default provider with no native session. The on-disk file can still
   * name the old id; every read the app uses goes through here.
   */
  private withoutUnregisteredProvider<T extends SessionMetadata>(meta: T): T {
    if (!meta.providerId) {
      return meta;
    }
    const registered = ProviderRegistry.getRegisteredProviderIds();
    // An empty registry means this process has not loaded providers yet.
    // Leave the stored id untouched instead of treating every chat as removed.
    if (registered.length === 0 || registered.includes(meta.providerId)) {
      return meta;
    }
    return {
      ...meta,
      providerId: DEFAULT_CHAT_PROVIDER_ID,
      sessionId: null,
      providerState: undefined,
    };
  }

  extractLightMetadata(raw: SessionMetadata): LightSessionMetadata {
    const messageCount = raw.messages?.length ?? 0;
    // The stored first prompt carries vault/graph/image envelopes; the index
    // strips them, so the preview is what the user actually typed.
    const searchIndex = raw.searchIndex
      ?? (messageCount > 0 ? buildConversationSearchIndex(raw.messages ?? []) : undefined);
    const preview = searchIndex?.preview ?? '';

    let lastResponseAt = raw.lastResponseAt;
    if (lastResponseAt == null && raw.messages && raw.messages.length > 0) {
      for (let m = raw.messages.length - 1; m >= 0; m--) {
        if (raw.messages[m].role === 'assistant') {
          lastResponseAt = raw.messages[m].timestamp;
          break;
        }
      }
    }

    return this.withoutUnregisteredProvider({
      id: raw.id,
      providerId: raw.providerId,
      title: raw.title,
      titleGenerationStatus: raw.titleGenerationStatus,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
      lastResponseAt,
      sessionId: raw.sessionId,
      goal: raw.goal,
      goalProviderId: raw.goalProviderId,
      nativeGoal: raw.nativeGoal,
      workspaceMode: raw.workspaceMode,
      pinned: raw.pinned,
      currentNote: raw.currentNote,
      externalContextPaths: raw.externalContextPaths,
      enabledMcpServers: raw.enabledMcpServers,
      usage: raw.usage,
      resumeAtMessageId: raw.resumeAtMessageId,
      providerState: raw.providerState
        ? { ...raw.providerState, subagentData: undefined }
        : undefined,
      providerSessions: (() => {
        if (!raw.providerSessions || typeof raw.providerSessions !== "object") return undefined;
        const cleaned: Record<string, ProviderSessionSnapshot> = {};
        for (const [pk, pv] of Object.entries(raw.providerSessions)) {
          if (!pv || typeof pv !== "object") continue;
          const pState = pv.providerState ? { ...pv.providerState, subagentData: undefined } : undefined;
          cleaned[pk] = { ...pv, providerState: pState };
        }
        return cleaned;
      })(),
      pendingContextBootstrap: typeof raw.pendingContextBootstrap === "string"
        ? raw.pendingContextBootstrap
        : undefined,
      searchIndex,
      messages: [],
      _messageCount: messageCount,
      _preview: preview,
      _lazyMessages: messageCount > 0 || !!raw.providerState?.subagentData || !!raw.pendingContextBootstrap,
    });
  }

  async saveMetadata(metadata: SessionMetadata): Promise<void> {
    if (this.trashedIds.has(metadata.id)) return;
    const filePath = this.getMetadataPath(metadata.id);
    const content = JSON.stringify(metadata, null, 2);
    await this.writeFile(filePath, content);
    await this.deleteLegacyMetadataIfPresent(metadata.id);

    if (this.indexCache) {
      const light = this.extractLightMetadata(metadata);
      this.indexCache.set(metadata.id, light);
      this.scheduleIndexSave();
    }
  }

  /**
   * The one save path for a conversation. A chat whose messages were never
   * loaded (startup reconciliation, a pin from the history list) is merged onto
   * its file instead of replacing it: its in-memory copy has an empty message
   * list, and saving that as-is is how chats used to come back empty.
   */
  async saveConversation(conversation: Conversation): Promise<'saved' | 'skipped'> {
    const next = this.toSessionMetadata(conversation);
    if (!(conversation as Conversation & LazyConversationFlags)._lazyMessages) {
      await this.saveMetadata(next);
      return 'saved';
    }
    const flags = conversation as Conversation & LazyConversationFlags;
    const stored = await this.loadMetadataDetailed(conversation.id);
    if (stored.status === 'ok') {
      await this.saveMetadata(flags._stub
        ? mergeStubSave(stored.metadata, next)
        : mergeUnloadedSave(stored.metadata, next));
      return 'saved';
    }
    if (stored.status === 'missing') {
      // The listing knew messages: the file is only gone for now (a sync
      // placeholder, a stale index). Writing an empty chat would replace it.
      if ((flags._messageCount ?? 0) > 0 || flags._stub) return 'skipped';
      await this.saveMetadata(next);
      return 'saved';
    }
    // corrupt / unreadable: the file is the only copy of those messages.
    return 'skipped';
  }

  async loadMetadata(id: string): Promise<SessionMetadata | null> {
    const result = await this.loadMetadataDetailed(id);
    return result.status === 'ok' ? result.metadata : null;
  }

  /**
   * Loads a session file and says why when it cannot. A file that fails to
   * parse is copied byte for byte to the recovery folder before anything can
   * save over it.
   */
  async loadMetadataDetailed(id: string): Promise<SessionLoadResult> {
    const filePath = await this.getLoadPath(id);
    if (!filePath) {
      return { status: 'missing' };
    }

    let content: string;
    try {
      content = await this.adapter.read(filePath);
    } catch {
      return { status: 'unreadable' };
    }

    let metadata: SessionMetadata;
    try {
      metadata = this.withoutUnregisteredProvider(JSON.parse(content) as SessionMetadata);
    } catch {
      return { status: 'corrupt', backupPath: await this.backUpCorruptFile(id, filePath, content) };
    }

    if (filePath !== this.getMetadataPath(id)) {
      await this.saveMetadata(metadata);
    }
    return { status: 'ok', metadata };
  }

  private async backUpCorruptFile(id: string, filePath: string, content: string): Promise<string | null> {
    if (this.backedUpCorruptPaths.has(filePath)) return null;
    // Named by content, so the same broken file is copied once, not at every start.
    const backupPath = `${CORRUPT_SESSIONS_PATH}/${id}.${contentHash(content)}.meta.json`;
    try {
      if (await this.adapter.exists(backupPath)) {
        this.backedUpCorruptPaths.add(filePath);
        return backupPath;
      }
      await this.writeFile(backupPath, content);
      this.backedUpCorruptPaths.add(filePath);
      return backupPath;
    } catch {
      return null;
    }
  }

  async deleteMetadata(id: string): Promise<void> {
    await this.adapter.delete(this.getMetadataPath(id));
    await this.deleteLegacyMetadataIfPresent(id);

    if (this.indexCache) {
      this.indexCache.delete(id);
      this.scheduleIndexSave();
    }
  }

  async listMetadata(): Promise<SessionMetadata[]> {
    const listed = await this.listUniqueMetadataFiles();
    if (listed === null) {
      return this.listFromIndexOnly();
    }
    const files = listed;

    const returnOrderedFiles = (): SessionMetadata[] => {
      const ordered: SessionMetadata[] = [];
      for (const file of files) {
        const id = this.getFileName(file).replace(/\.meta\.json$/, "");
        const item = this.indexCache?.get(id);
        if (item) {
          ordered.push(this.withoutUnregisteredProvider(item));
        }
      }
      return ordered;
    };

    if (this.indexCache) {
      return returnOrderedFiles();
    }

    this.indexCache = new Map();

    // 1. Try to read persisted index cache for instant sub-millisecond startup
    let indexLoaded = false;
    let droppedUnregisteredProvider = false;
    try {
      if (await this.adapter.exists(SESSIONS_INDEX_PATH)) {
        const content = await this.adapter.read(SESSIONS_INDEX_PATH);
        const parsed = JSON.parse(content) as Record<string, SessionMetadata>;
        if (parsed && typeof parsed === "object") {
          for (const [id, meta] of Object.entries(parsed)) {
            if (id && meta && meta.id) {
              const safe = this.withoutUnregisteredProvider(meta);
              if (safe !== meta) {
                droppedUnregisteredProvider = true;
              }
              this.indexCache.set(id, safe);
            }
          }
          indexLoaded = true;
        }
      }
    } catch {
      this.indexCache.clear();
      droppedUnregisteredProvider = false;
    }

    const diskIdSet = new Set<string>();
    for (const file of files) {
      const fileName = this.getFileName(file);
      const id = fileName.replace(/\.meta\.json$/, "");
      if (id) {
        diskIdSet.add(id);
      }
    }

    // Fast path: index loaded, reconcile with files on disk
    if (indexLoaded && this.indexCache.size > 0) {
      let indexDirty = droppedUnregisteredProvider;

      // Remove deleted files
      for (const id of Array.from(this.indexCache.keys())) {
        if (!diskIdSet.has(id)) {
          this.indexCache.delete(id);
          indexDirty = true;
        }
      }

      // Add missing files not yet in index
      const missingFiles = files.filter((filePath) => {
        const id = this.getFileName(filePath).replace(/\.meta\.json$/, "");
        return id && !this.indexCache!.has(id);
      });

      if (missingFiles.length > 0) {
        indexDirty = true;
        for (const filePath of missingFiles) {
          const light = await this.ingestMetadataFile(filePath);
          if (light) {
            this.indexCache.set(light.id, light);
          }
        }
      }

      if (indexDirty) {
        this.scheduleIndexSave();
      }

      return returnOrderedFiles();
    }

    // Cold path: read + parse metadata files in bounded batches
    const BATCH_SIZE = 15;
    for (let i = 0; i < files.length; i += BATCH_SIZE) {
      const batch = files.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map((filePath) => this.ingestMetadataFile(filePath)),
      );

      for (const item of batchResults) {
        if (item) {
          this.indexCache.set(item.id, item);
        }
      }
    }

    this.scheduleIndexSave();
    return returnOrderedFiles();
  }

  /**
   * A folder listing that failed says nothing about which chats exist. Serve
   * the persisted index untouched rather than pruning every entry from it.
   */
  private async listFromIndexOnly(): Promise<SessionMetadata[]> {
    if (!this.indexCache) {
      this.indexCache = new Map();
      try {
        const parsed = JSON.parse(await this.adapter.read(SESSIONS_INDEX_PATH)) as Record<string, SessionMetadata>;
        for (const [id, meta] of Object.entries(parsed ?? {})) {
          if (id && meta?.id) this.indexCache.set(id, meta);
        }
      } catch {
        // No index either: nothing can be listed this time.
      }
      const entries = Array.from(this.indexCache.values());
      // Retry the listing next time instead of trusting this partial state.
      this.indexCache = null;
      return entries.map((meta) => this.withoutUnregisteredProvider(meta));
    }
    return Array.from(this.indexCache.values()).map((meta) => this.withoutUnregisteredProvider(meta));
  }

  async listAllConversations(): Promise<ConversationMeta[]> {
    const nativeMetas = await this.listMetadata();

    const metas: ConversationMeta[] = nativeMetas.map((meta) => ({
      id: meta.id,
      providerId: meta.providerId ?? DEFAULT_CHAT_PROVIDER_ID,
      title: meta.title,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
      lastResponseAt: meta.lastResponseAt,
      messageCount: 0,
      preview: 'SDK session',
      titleGenerationStatus: meta.titleGenerationStatus,
    }));

    return metas.sort((a, b) =>
      (b.lastResponseAt ?? b.createdAt) - (a.lastResponseAt ?? a.createdAt)
    );
  }

  toSessionMetadata(conversation: Conversation): SessionMetadata {
    const providerState = ProviderRegistry
      .getConversationHistoryService(conversation.providerId)
      .buildPersistedProviderState?.(conversation)
      ?? conversation.providerState;

    return {
      id: conversation.id,
      providerId: conversation.providerId,
      title: conversation.title,
      titleGenerationStatus: conversation.titleGenerationStatus,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      lastResponseAt: conversation.lastResponseAt,
      sessionId: conversation.sessionId,
      // Before the bulky provider state: a large file's listing reads only its head.
      pinned: conversation.pinned || undefined,
      providerState: providerState && Object.keys(providerState).length > 0 ? providerState : undefined,
      providerSessions: conversation.providerSessions && Object.keys(conversation.providerSessions).length > 0
        ? conversation.providerSessions
        : undefined,
      pendingContextBootstrap: conversation.pendingContextBootstrap || undefined,
      goal: conversation.goal ?? undefined,
      goalProviderId: conversation.goal ? (conversation.goalProviderId ?? undefined) : undefined,
      nativeGoal: conversation.goal ? (conversation.nativeGoal ?? undefined) : undefined,
      workspaceMode: conversation.workspaceMode,
      messages: conversation.messages.length > 0
        ? toPersistedMessages(conversation.messages)
        : undefined,
      currentNote: conversation.currentNote,
      externalContextPaths: conversation.externalContextPaths,
      enabledMcpServers: conversation.enabledMcpServers,
      usage: conversation.usage,
      resumeAtMessageId: conversation.resumeAtMessageId,
      // Rebuilt only from messages in memory; a chat saved while unloaded (pin,
      // rename, title) keeps the index it has instead of losing it.
      searchIndex: (conversation.messages.length > 0
        ? buildConversationSearchIndex(conversation.messages)
        : undefined) ?? conversation.searchIndex,
    };
  }

  /**
   * Records a chat's search index in the index cache only. Used when messages
   * were loaded from a provider transcript: the metadata file picks the index
   * up on the chat's next real save, without a rewrite now.
   */
  rememberSearchIndex(id: string, searchIndex: ConversationSearchIndex): void {
    const entry = this.indexCache?.get(id) as LightSessionMetadata | undefined;
    if (!entry) return;
    this.rememberLightInIndex({ ...entry, searchIndex, _preview: searchIndex.preview });
  }

  /**
   * Builds the search index for entries an older build listed without one,
   * from the messages their metadata files already contain. Oversized files
   * are skipped here, as in compaction; they index when opened.
   */
  async backfillSearchIndexes(
    options: { yieldBetweenFiles?: () => Promise<void> } = {},
  ): Promise<Array<{ id: string; searchIndex: ConversationSearchIndex }>> {
    if (!this.indexCache) return [];
    const pending = Array.from(this.indexCache.values())
      .filter((entry) => !entry.searchIndex && ((entry as LightSessionMetadata)._messageCount ?? 0) > 0)
      .map((entry) => entry.id);
    const updated: Array<{ id: string; searchIndex: ConversationSearchIndex }> = [];
    for (const id of pending) {
      try {
        const path = await this.getLoadPath(id);
        if (!path) continue;
        if (typeof this.adapter.stat === 'function') {
          const st = await this.adapter.stat(path);
          if (st && st.size > MAX_BACKGROUND_COMPACT_BYTES) continue;
        }
        const raw = JSON.parse(await this.adapter.read(path)) as SessionMetadata;
        const searchIndex = raw.searchIndex ?? buildConversationSearchIndex(raw.messages ?? []);
        if (!searchIndex) continue;
        this.rememberSearchIndex(id, searchIndex);
        updated.push({ id, searchIndex });
      } catch {
        // An unreadable file keeps its old row; indexing is best-effort.
      }
      await options.yieldBetweenFiles?.();
    }
    return updated;
  }

  /**
   * Rewrites session files that were written before tool results were capped.
   *
   * Capping on save only helps conversations that get saved again — an archive
   * of 252 files totalling 264 MB would otherwise stay that size forever, and
   * `listMetadata()` reads and parses every one of them on the first awaited
   * step of `onload`.
   *
   * Runs off the startup path, one file at a time, yielding between files: this
   * is the Electron renderer, and reading + parsing + rewriting a 17 MB file is
   * exactly the kind of work that freezes the window if done in a tight loop.
   * Files already within budget are left untouched, so this converges to a
   * no-op after the first run.
   *
   * @param onProgress Invoked per rewritten file with the bytes reclaimed.
   * @returns Total bytes reclaimed.
   */
  async compactOversizedMetadata(
    options: { yieldBetweenFiles?: () => Promise<void>; onProgress?: (reclaimed: number) => void } = {},
  ): Promise<number> {
    const yieldBetweenFiles = options.yieldBetweenFiles
      ?? (() => new Promise<void>((resolve) => window.setTimeout(resolve, 0)));

    const files = await this.listMetadataFiles(SESSIONS_PATH);
    let reclaimed = 0;
    const canStat = typeof this.adapter.stat === 'function';

    for (const filePath of files) {
      await yieldBetweenFiles();
      try {
        let size: number | null = null;
        if (canStat) {
          const st = await this.adapter.stat(filePath);
          size = st?.size ?? null;
          if (size !== null && size <= OVERSIZED_METADATA_BYTES) {
            continue;
          }
          if (size !== null && this.compactedMinimalSizes.get(filePath) === size) {
            continue;
          }
          // JSON.parse of a 14 MB session freezes the renderer. Leave archives
          // this large for the next open+save, which already caps tool results.
          if (size !== null && size > MAX_BACKGROUND_COMPACT_BYTES) {
            this.compactedMinimalSizes.set(filePath, size);
            continue;
          }
        }

        if (this.writesInFlight.has(filePath)) continue;
        const generationAtRead = this.writeGenerations.get(filePath) ?? 0;
        const content = await this.adapter.read(filePath);
        if (content.length <= OVERSIZED_METADATA_BYTES) {
          this.compactedMinimalSizes.set(filePath, size ?? content.length);
          continue;
        }

        const metadata = JSON.parse(content) as SessionMetadata;

        let modified = false;
        const compacted: SessionMetadata = { ...metadata };

        if (compacted.messages?.length) {
          compacted.messages = toPersistedMessages(compacted.messages);
          modified = true;
        }

        if (compacted.providerState?.subagentData) {
          const subMap = compacted.providerState.subagentData as Record<string, SubagentInfo>;
          const nextSubMap: Record<string, SubagentInfo> = {};
          for (const [id, sub] of Object.entries(subMap)) {
            nextSubMap[id] = toPersistedSubagent(sub);
          }
          compacted.providerState = {
            ...compacted.providerState,
            subagentData: nextSubMap,
          };
          modified = true;
        }

        if (compacted.providerSessions && typeof compacted.providerSessions === "object") {
          for (const pSession of Object.values(compacted.providerSessions)) {
            if (pSession && typeof pSession === "object" && (pSession as any).providerState?.subagentData) {
              const subMap = (pSession as any).providerState.subagentData as Record<string, SubagentInfo>;
              const nextSubMap: Record<string, SubagentInfo> = {};
              for (const [id, sub] of Object.entries(subMap)) {
                nextSubMap[id] = toPersistedSubagent(sub);
              }
              (pSession as any).providerState = {
                ...(pSession as any).providerState,
                subagentData: nextSubMap,
              };
              modified = true;
            }
          }
        }

        if (!modified) {
          this.compactedMinimalSizes.set(filePath, size ?? content.length);
          this.rememberLightInIndex(this.extractLightMetadata(metadata));
          continue;
        }

        const next = JSON.stringify(compacted, null, 2);
        if (next.length >= content.length) {
          this.compactedMinimalSizes.set(filePath, size ?? content.length);
          this.rememberLightInIndex(this.extractLightMetadata(metadata));
          continue;
        }

        // A save that started or landed after the read is newer than this rewrite.
        if (!this.isUntouchedSince(filePath, generationAtRead)) {
          continue;
        }
        await this.writeFile(filePath, next);
        reclaimed += content.length - next.length;
        options.onProgress?.(content.length - next.length);
        this.compactedMinimalSizes.set(filePath, next.length);
        this.rememberLightInIndex(this.extractLightMetadata(compacted));
      } catch {
        // A corrupt or unreadable file is skipped; compaction is best-effort and
        // must never be the reason a conversation disappears.
      }
    }

    return reclaimed;
  }

  private rememberLightInIndex(light: LightSessionMetadata): void {
    if (!this.indexCache) return;
    this.indexCache.set(light.id, light);
    this.scheduleIndexSave();
  }

  private async stubOversizedMetadata(filePath: string, id: string, mtime: number): Promise<LightSessionMetadata> {
    let head = '';
    try {
      head = typeof this.adapter.readHead === 'function'
        ? await this.adapter.readHead(filePath, STUB_HEAD_BYTES)
        : '';
    } catch {
      // The stub below still lists the chat; its title fills in on open.
    }
    const text = (key: string): string | undefined => {
      const value = readHeaderField(head, key);
      return typeof value === 'string' && value ? value : undefined;
    };
    const time = (key: string): number | undefined => {
      const value = readHeaderField(head, key);
      return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
    };
    const createdAt = time('createdAt') ?? mtime;
    return this.withoutUnregisteredProvider({
      id,
      ...(text('providerId') ? { providerId: text('providerId') } : {}),
      title: text('title') ?? id,
      createdAt,
      updatedAt: time('updatedAt') ?? mtime,
      lastResponseAt: time('lastResponseAt') ?? mtime,
      ...(text('sessionId') ? { sessionId: text('sessionId') } : {}),
      ...(readHeaderField(head, 'pinned') === true ? { pinned: true } : {}),
      messages: [],
      _messageCount: 0,
      _preview: '',
      _lazyMessages: true,
      _stub: true,
    });
  }

  /**
   * Builds light index metadata for one session file without pulling oversized
   * transcripts into the renderer. Title/preview for those arrive later, when
   * the conversation is opened or background-compacted.
   */
  private async ingestMetadataFile(filePath: string): Promise<LightSessionMetadata | null> {
    const id = this.getFileName(filePath).replace(/\.meta\.json$/, '');
    if (!id) return null;

    try {
      if (typeof this.adapter.stat === 'function') {
        const st = await this.adapter.stat(filePath);
        if (st && st.size > OVERSIZED_METADATA_BYTES) {
          return await this.stubOversizedMetadata(filePath, id, st.mtime);
        }
      }

      const content = await this.adapter.read(filePath);
      const raw = JSON.parse(content) as SessionMetadata;
      if (!raw?.id) return null;

      if (filePath.startsWith(`${LEGACY_SESSIONS_PATH}/`)) {
        await this.saveMetadata(raw);
      }

      return this.extractLightMetadata(raw);
    } catch {
      return null;
    }
  }

  private async getLoadPath(id: string): Promise<string | null> {
    const filePath = this.getMetadataPath(id);
    if (await this.adapter.exists(filePath)) {
      return filePath;
    }

    const legacyFilePath = this.getLegacyMetadataPath(id);
    if (await this.adapter.exists(legacyFilePath)) {
      return legacyFilePath;
    }

    return null;
  }

  private async deleteLegacyMetadataIfPresent(id: string): Promise<void> {
    const legacyFilePath = this.getLegacyMetadataPath(id);
    if (await this.adapter.exists(legacyFilePath)) {
      await this.adapter.delete(legacyFilePath);
    }
  }

  /** Null when the session folder could not be listed (as opposed to being empty). */
  private async listUniqueMetadataFiles(): Promise<string[] | null> {
    let preferredFiles: string[];
    try {
      preferredFiles = await this.listMetadataFilesStrict(SESSIONS_PATH);
    } catch {
      return null;
    }
    const fallbackFiles = await this.listMetadataFiles(LEGACY_SESSIONS_PATH);
    const filesByName = new Map<string, string>();

    for (const filePath of preferredFiles) {
      filesByName.set(this.getFileName(filePath), filePath);
    }

    for (const filePath of fallbackFiles) {
      const fileName = this.getFileName(filePath);
      if (!filesByName.has(fileName)) {
        filesByName.set(fileName, filePath);
      }
    }

    return Array.from(filesByName.values());
  }

  private async listMetadataFiles(folderPath: string): Promise<string[]> {
    try {
      return await this.listMetadataFilesStrict(folderPath);
    } catch {
      return [];
    }
  }

  private async listMetadataFilesStrict(folderPath: string): Promise<string[]> {
    const files = await this.adapter.listFiles(folderPath);
    return files.filter((filePath) => filePath.endsWith('.meta.json'));
  }

  // ── Trash ────────────────────────────────────────────────────────────────

  private trashPathFor(id: string): string {
    return `${TRASH_PATH}/${id}.meta.json`;
  }

  private async readTrashIndex(): Promise<Record<string, TrashEntry>> {
    try {
      if (!(await this.adapter.exists(TRASH_INDEX_PATH))) return {};
      const parsed = JSON.parse(await this.adapter.read(TRASH_INDEX_PATH)) as Record<string, TrashEntry>;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  private async writeTrashIndex(index: Record<string, TrashEntry>): Promise<void> {
    await this.writeFile(TRASH_INDEX_PATH, JSON.stringify(index, null, 2));
  }

  private async moveFile(from: string, to: string): Promise<void> {
    if (await this.adapter.exists(to)) {
      await this.adapter.delete(to);
    }
    try {
      await this.adapter.rename(from, to);
    } catch {
      // Some adapters cannot rename across folders; copy, then remove.
      await this.writeFile(to, await this.adapter.read(from));
      await this.adapter.delete(from);
    }
  }

  /**
   * Deleting a chat moves its file here instead of removing it. The provider's
   * own transcript stays until the entry is purged, so a restore is complete.
   */
  async moveToTrash(id: string, options: { deletedAt?: number } = {}): Promise<boolean> {
    this.trashedIds.add(id);
    const light = this.indexCache?.get(id);
    if (this.indexCache?.delete(id)) {
      this.scheduleIndexSave();
    }
    // A save already queued for this file lands first; then it moves.
    await this.adapter.whenWritten?.(this.getMetadataPath(id));
    const filePath = await this.getLoadPath(id);
    if (!filePath) return false;

    await this.adapter.ensureFolder?.(TRASH_PATH);
    await this.moveFile(filePath, this.trashPathFor(id));
    await this.deleteLegacyMetadataIfPresent(id);

    await this.updateTrashIndex((index) => {
      index[id] = {
        id,
        title: light?.title ?? id,
        ...(light?.providerId ? { providerId: light.providerId } : {}),
        deletedAt: options.deletedAt ?? Date.now(),
      };
    });
    return true;
  }

  /** Serialized read-modify-write of the trash index: two quick deletes must both land. */
  private updateTrashIndex(change: (index: Record<string, TrashEntry>) => void): Promise<void> {
    const run = async (): Promise<void> => {
      const index = await this.readTrashIndex();
      change(index);
      await this.writeTrashIndex(index);
    };
    const result = this.trashIndexChain.then(run, run);
    this.trashIndexChain = result.catch(() => undefined);
    return result;
  }

  async listTrash(): Promise<TrashEntry[]> {
    const index = await this.readTrashIndex();
    return Object.values(index).sort((a, b) => b.deletedAt - a.deletedAt);
  }

  /** Moves a trashed chat back. Never replaces a live file of the same id. */
  async restoreFromTrash(id: string): Promise<SessionMetadata | null> {
    const trashPath = this.trashPathFor(id);
    const targetPath = this.getMetadataPath(id);
    if (!(await this.adapter.exists(trashPath)) || await this.adapter.exists(targetPath)) {
      return null;
    }
    this.trashedIds.delete(id);
    await this.moveFile(trashPath, targetPath);

    await this.updateTrashIndex((index) => {
      delete index[id];
    });

    const light = await this.ingestMetadataFile(targetPath);
    if (light && this.indexCache) {
      this.indexCache.set(light.id, light);
      this.scheduleIndexSave();
    }
    return light;
  }

  /**
   * Removes trash entries past the retention for good. `onPurge` runs first so
   * the caller can drop the provider's own transcript of that chat.
   */
  async purgeTrash(options: {
    now?: number;
    maxAgeMs: number;
    onPurge?: (metadata: SessionMetadata) => Promise<void>;
  }): Promise<string[]> {
    const now = options.now ?? Date.now();
    const index = await this.readTrashIndex();
    const purged: string[] = [];
    for (const entry of Object.values(index)) {
      if (now - entry.deletedAt < options.maxAgeMs) continue;
      const trashPath = this.trashPathFor(entry.id);
      try {
        if (await this.adapter.exists(trashPath)) {
          // A live file of the same id (restored, or recreated by a late save)
          // still needs the provider's transcript; only the trashed copy goes.
          const live = await this.adapter.exists(this.getMetadataPath(entry.id));
          if (!live) {
            try {
              const metadata = JSON.parse(await this.adapter.read(trashPath)) as SessionMetadata;
              await options.onPurge?.(metadata);
            } catch {
              // An unreadable trashed file is still removed once it expired.
            }
          }
          await this.adapter.delete(trashPath);
        }
        purged.push(entry.id);
      } catch {
        // Try again at the next purge.
      }
    }
    if (purged.length > 0) {
      await this.updateTrashIndex((current) => {
        for (const id of purged) delete current[id];
      });
    }
    return purged;
  }

  private getFileName(filePath: string): string {
    const parts = filePath.split('/');
    return parts[parts.length - 1] ?? filePath;
  }
}
