import * as path from 'path';

import { CLAUDIAN_STORAGE_PATH } from '../../../core/bootstrap/StoragePaths';
import { readJsonFile, SerialJsonFileWriter } from '../../../core/storage/atomicJsonFile';

export const COMPOSER_DRAFTS_PATH = `${CLAUDIAN_STORAGE_PATH}/composer-drafts.json`;

/** Null outside a desktop vault: drafts then live in memory for the session. */
export function composerDraftsFilePath(vaultPath: string | null): string | null {
  return vaultPath ? path.join(vaultPath, COMPOSER_DRAFTS_PATH) : null;
}

/** Longer than this is almost certainly a paste that lives elsewhere anyway. */
export const MAX_DRAFT_TEXT_LENGTH = 20_000;
const MAX_DRAFT_ATTACHMENTS = 50;
const MAX_DRAFT_IMAGES = 50;
const DEFAULT_DEBOUNCE_MS = 400;

export interface ComposerDraftAttachment {
  name: string;
  relPath: string;
  size?: number;
}

/** Everything in a composer that has not been sent yet. */
export interface ComposerDraftContent {
  text: string;
  attachments: ComposerDraftAttachment[];
  /** Ids in ImageStagingService; the bytes stay in the staging folder. */
  imageIds: string[];
}

export interface ComposerDraft extends ComposerDraftContent {
  updatedAt: number;
}

interface DraftFile {
  version: 1;
  drafts: Record<string, ComposerDraft>;
}

/** A draft belongs to its conversation, so it outlives the tab it was typed in. */
export function conversationDraftKey(conversationId: string): string {
  return `conversation:${conversationId}`;
}

/** A tab with no conversation yet keeps its draft until the conversation exists. */
export function tabDraftKey(tabId: string): string {
  return `tab:${tabId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeAttachments(value: unknown): ComposerDraftAttachment[] {
  if (!Array.isArray(value)) return [];
  const attachments: ComposerDraftAttachment[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.name !== 'string' || typeof entry.relPath !== 'string' || !entry.relPath) {
      continue;
    }
    attachments.push({
      name: entry.name,
      relPath: entry.relPath,
      ...(typeof entry.size === 'number' && Number.isFinite(entry.size) ? { size: entry.size } : {}),
    });
    if (attachments.length >= MAX_DRAFT_ATTACHMENTS) break;
  }
  return attachments;
}

function normalizeImageIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((id): id is string => typeof id === 'string' && id.length > 0).slice(0, MAX_DRAFT_IMAGES);
}

function normalizeContent(content: ComposerDraftContent): ComposerDraftContent | null {
  const text = typeof content.text === 'string' ? content.text.slice(0, MAX_DRAFT_TEXT_LENGTH) : '';
  const attachments = normalizeAttachments(content.attachments);
  const imageIds = normalizeImageIds(content.imageIds);
  if (!text.trim() && attachments.length === 0 && imageIds.length === 0) {
    return null;
  }
  return { text, attachments, imageIds };
}

/**
 * Unsent composer contents per conversation (or per blank tab), saved while the
 * user types so a restart, a crash or a closed tab does not lose them.
 */
export class ComposerDraftStore {
  private drafts = new Map<string, ComposerDraft>();
  private listeners = new Set<() => void>();
  private readonly writer: SerialJsonFileWriter | null;
  private readonly debounceMs: number;
  private readonly now: () => number;
  private saveTimer: number | null = null;

  constructor(
    private readonly filePath: string | null,
    options: { debounceMs?: number; now?: () => number } = {},
  ) {
    this.writer = filePath ? new SerialJsonFileWriter(filePath) : null;
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.now = options.now ?? (() => Date.now());
  }

  async load(): Promise<void> {
    if (!this.filePath) return;
    const stored = await readJsonFile(this.filePath);
    const drafts = isRecord(stored) && isRecord(stored.drafts) ? stored.drafts : {};
    this.drafts.clear();
    for (const [key, value] of Object.entries(drafts)) {
      if (!isRecord(value)) continue;
      const content = normalizeContent({
        text: typeof value.text === 'string' ? value.text : '',
        attachments: normalizeAttachments(value.attachments),
        imageIds: normalizeImageIds(value.imageIds),
      });
      if (!content) continue;
      this.drafts.set(key, {
        ...content,
        updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : 0,
      });
    }
    this.writer?.markWritten(this.serialize());
    this.emit();
  }

  get(key: string): ComposerDraft | null {
    const draft = this.drafts.get(key);
    return draft
      ? { ...draft, attachments: draft.attachments.map(a => ({ ...a })), imageIds: [...draft.imageIds] }
      : null;
  }

  has(key: string): boolean {
    return this.drafts.has(key);
  }

  hasConversationDraft(conversationId: string): boolean {
    return this.drafts.has(conversationDraftKey(conversationId));
  }

  /** Saves the composer contents; an empty composer removes the draft. */
  set(key: string, content: ComposerDraftContent): void {
    const normalized = normalizeContent(content);
    if (!normalized) {
      this.delete(key);
      return;
    }
    const hadDraft = this.drafts.has(key);
    this.drafts.set(key, { ...normalized, updatedAt: this.now() });
    this.scheduleSave();
    if (!hadDraft) this.emit();
  }

  delete(key: string): void {
    if (!this.drafts.delete(key)) return;
    this.scheduleSave();
    this.emit();
  }

  /** Re-keys a draft, e.g. when a blank tab's first conversation is created. */
  move(fromKey: string, toKey: string): void {
    const draft = this.drafts.get(fromKey);
    if (!draft || fromKey === toKey) return;
    this.drafts.delete(fromKey);
    this.drafts.set(toKey, draft);
    this.scheduleSave();
    this.emit();
  }

  /** Called when a chat's presence of a draft changes, not on every keystroke. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async flush(): Promise<void> {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await this.writer?.write(this.serialize());
  }

  private scheduleSave(): void {
    if (!this.writer) return;
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.writer?.write(this.serialize()).catch(() => undefined);
    }, this.debounceMs);
  }

  private serialize(): DraftFile {
    return { version: 1, drafts: Object.fromEntries(this.drafts) };
  }

  private emit(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // A failing UI refresh must not stop the others or the save.
      }
    }
  }
}
