import { ProviderRegistry } from '../providers/ProviderRegistry';
import { DEFAULT_CHAT_PROVIDER_ID } from '../providers/types';
import type { VaultFileAdapter } from '../storage/VaultFileAdapter';
import type {
  Conversation,
  ConversationMeta,
  SessionMetadata,
} from '../types';
import { toPersistedMessages } from './persistedMessages';
import { LEGACY_SESSIONS_PATH, SESSIONS_PATH } from './StoragePaths';

export {
  LEGACY_SESSIONS_PATH,
  SESSIONS_PATH,
};

/**
 * Above this, a session file is assumed to predate tool-result capping and is
 * worth rewriting. Comfortably larger than any capped conversation, so healthy
 * files are never touched.
 */
const OVERSIZED_METADATA_BYTES = 512_000;

export class SessionStorage {
  constructor(private adapter: VaultFileAdapter) {}

  getMetadataPath(id: string): string {
    return `${SESSIONS_PATH}/${id}.meta.json`;
  }

  getLegacyMetadataPath(id: string): string {
    return `${LEGACY_SESSIONS_PATH}/${id}.meta.json`;
  }

  async saveMetadata(metadata: SessionMetadata): Promise<void> {
    const filePath = this.getMetadataPath(metadata.id);
    const content = JSON.stringify(metadata, null, 2);
    await this.adapter.write(filePath, content);
    await this.deleteLegacyMetadataIfPresent(metadata.id);
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
  }

  async listMetadata(): Promise<SessionMetadata[]> {
    const files = await this.listUniqueMetadataFiles();

    // Read + parse every metadata file in parallel. This is the first awaited
    // step of onload and previously read each file one-by-one, scaling linearly
    // with the conversation count. Order is preserved by mapping over `files`;
    // unreadable/corrupt files resolve to null and are filtered out — identical
    // to the prior skip-on-error behavior.
    const results = await Promise.all(
      files.map(async (filePath) => {
        try {
          const content = await this.adapter.read(filePath);
          const raw = JSON.parse(content) as SessionMetadata;

          if (filePath.startsWith(`${LEGACY_SESSIONS_PATH}/`)) {
            await this.saveMetadata(raw);
          }
          return raw;
        } catch {
          // Skip files that fail to load.
          return null;
        }
      }),
    );

    return results.filter((meta): meta is SessionMetadata => meta !== null);
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
      ?? (() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

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
        if (!metadata.messages?.length) {
          continue;
        }

        const compacted: SessionMetadata = {
          ...metadata,
          messages: toPersistedMessages(metadata.messages),
        };
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
