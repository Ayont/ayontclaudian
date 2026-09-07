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
import { LEGACY_SESSIONS_PATH, SESSIONS_INDEX_PATH, SESSIONS_PATH } from './StoragePaths';

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

export class SessionStorage {
  private indexCache: Map<string, SessionMetadata> | null = null;
  private indexSaveTimer: number | null = null;

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
      await this.adapter.write(SESSIONS_INDEX_PATH, JSON.stringify(obj));
    } catch {
      // Non-fatal background cache write
    }
  }

  extractLightMetadata(raw: SessionMetadata): SessionMetadata & {
    _messageCount?: number;
    _preview?: string;
    _lazyMessages?: boolean;
  } {
    const messageCount = raw.messages?.length ?? 0;
    let preview = '';
    if (raw.messages && raw.messages.length > 0) {
      const firstUser = raw.messages.find((m) => m.role === 'user');
      if (firstUser?.content) {
        const clean = firstUser.content.replace(/\n/g, ' ').trim();
        preview = clean.length > 50 ? clean.slice(0, 50) + '...' : clean;
      }
    }

    let lastResponseAt = raw.lastResponseAt;
    if (lastResponseAt == null && raw.messages && raw.messages.length > 0) {
      for (let m = raw.messages.length - 1; m >= 0; m--) {
        if (raw.messages[m].role === 'assistant') {
          lastResponseAt = raw.messages[m].timestamp;
          break;
        }
      }
    }

    return {
      id: raw.id,
      providerId: raw.providerId,
      title: raw.title,
      titleGenerationStatus: raw.titleGenerationStatus,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
      lastResponseAt,
      sessionId: raw.sessionId,
      goal: raw.goal,
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
      providerSessions: raw.providerSessions,
      pendingContextBootstrap: raw.pendingContextBootstrap,
      messages: [],
      _messageCount: messageCount,
      _preview: preview,
      _lazyMessages: messageCount > 0 || !!raw.providerState?.subagentData,
    };
  }

  async saveMetadata(metadata: SessionMetadata): Promise<void> {
    const filePath = this.getMetadataPath(metadata.id);
    const content = JSON.stringify(metadata, null, 2);
    await this.adapter.write(filePath, content);
    await this.deleteLegacyMetadataIfPresent(metadata.id);

    if (this.indexCache) {
      const light = this.extractLightMetadata(metadata);
      this.indexCache.set(metadata.id, light);
      this.scheduleIndexSave();
    }
  }

  async loadMetadata(id: string): Promise<SessionMetadata | null> {
    const filePath = await this.getLoadPath(id);

    try {
      if (!filePath) {
        return null;
      }

      const content = await this.adapter.read(filePath);
      const metadata = JSON.parse(content) as SessionMetadata;

      if (filePath !== this.getMetadataPath(id)) {
        await this.saveMetadata(metadata);
      }

      return metadata;
    } catch (error) {
      // A corrupt/truncated meta file would otherwise make the conversation
      // silently vanish with no trace. Log it so it's diagnosable.
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[Claudian] failed to load conversation metadata for "${id}":`, message);
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
    const files = await this.listUniqueMetadataFiles();

    const returnOrderedFiles = (): SessionMetadata[] => {
      const ordered: SessionMetadata[] = [];
      for (const file of files) {
        const id = this.getFileName(file).replace(/\.meta\.json$/, "");
        const item = this.indexCache?.get(id);
        if (item) {
          ordered.push(item);
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
    try {
      if (await this.adapter.exists(SESSIONS_INDEX_PATH)) {
        const content = await this.adapter.read(SESSIONS_INDEX_PATH);
        const parsed = JSON.parse(content) as Record<string, SessionMetadata>;
        if (parsed && typeof parsed === "object") {
          for (const [id, meta] of Object.entries(parsed)) {
            if (id && meta && meta.id) {
              this.indexCache.set(id, meta);
            }
          }
          indexLoaded = true;
        }
      }
    } catch {
      this.indexCache.clear();
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
      let indexDirty = false;

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
          try {
            const content = await this.adapter.read(filePath);
            const raw = JSON.parse(content) as SessionMetadata;
            if (raw && raw.id) {
              const light = this.extractLightMetadata(raw);
              this.indexCache.set(raw.id, light);
            }
          } catch {
            // Skip unreadable file
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
        batch.map(async (filePath) => {
          try {
            const content = await this.adapter.read(filePath);
            const raw = JSON.parse(content) as SessionMetadata;

            if (filePath.startsWith(`${LEGACY_SESSIONS_PATH}/`)) {
              await this.saveMetadata(raw);
            }

            if (raw && raw.id) {
              return this.extractLightMetadata(raw);
            }
            return null;
          } catch {
            return null;
          }
        }),
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
      providerState: providerState && Object.keys(providerState).length > 0 ? providerState : undefined,
      providerSessions: conversation.providerSessions && Object.keys(conversation.providerSessions).length > 0
        ? conversation.providerSessions
        : undefined,
      pendingContextBootstrap: conversation.pendingContextBootstrap || undefined,
      goal: conversation.goal ?? undefined,
      workspaceMode: conversation.workspaceMode,
      pinned: conversation.pinned || undefined,
      messages: conversation.messages.length > 0
        ? toPersistedMessages(conversation.messages)
        : undefined,
      currentNote: conversation.currentNote,
      externalContextPaths: conversation.externalContextPaths,
      enabledMcpServers: conversation.enabledMcpServers,
      usage: conversation.usage,
      resumeAtMessageId: conversation.resumeAtMessageId,
    };
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

    for (const filePath of files) {
      await yieldBetweenFiles();
      try {
        const content = await this.adapter.read(filePath);
        if (content.length <= OVERSIZED_METADATA_BYTES) {
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

        if (!modified) {
          continue;
        }

        const next = JSON.stringify(compacted, null, 2);
        if (next.length >= content.length) {
          continue;
        }

        await this.adapter.write(filePath, next);
        reclaimed += content.length - next.length;
        options.onProgress?.(content.length - next.length);
      } catch {
        // A corrupt or unreadable file is skipped; compaction is best-effort and
        // must never be the reason a conversation disappears.
      }
    }

    return reclaimed;
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

  private async listUniqueMetadataFiles(): Promise<string[]> {
    const preferredFiles = await this.listMetadataFiles(SESSIONS_PATH);
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
      const files = await this.adapter.listFiles(folderPath);
      return files.filter((filePath) => filePath.endsWith('.meta.json'));
    } catch {
      return [];
    }
  }

  private getFileName(filePath: string): string {
    const parts = filePath.split('/');
    return parts[parts.length - 1] ?? filePath;
  }
}
