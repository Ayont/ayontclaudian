import { type App, normalizePath, Notice, TFile } from 'obsidian';

import { ProviderRegistry } from '../../../core/providers/ProviderRegistry';
import type { Conversation } from '../../../core/types/chat';
import { type ConversationExportOptions, formatConversationMarkdown, safeExportFileName } from './ConversationExporter';

export const DEFAULT_EXPORT_FOLDER = 'Claudian/Conversations';

/**
 * Writes a conversation to a Markdown note in the vault, returning the created
 * file. Handles folder creation, filename de-duplication, and opening the note.
 * The exported note lands in the vault, so it is automatically picked up by the
 * RAG indexer — closing the loop between a chat and durable vault knowledge.
 */
export async function exportConversationToNote(
  app: App,
  conversation: Conversation,
  options: { folder?: string; open?: boolean; format?: ConversationExportOptions } = {},
): Promise<TFile> {
  const folder = normalizePath((options.folder?.trim() || DEFAULT_EXPORT_FOLDER).replace(/^\/+|\/+$/g, ''));

  await ensureFolder(app, folder);

  const markdown = formatConversationMarkdown(conversation, {
    includeToolCalls: true,
    providerDisplayName: (id) => {
      try {
        return ProviderRegistry.getProviderDisplayName(id) ?? id;
      } catch {
        return id;
      }
    },
    ...options.format,
  });

  const baseName = safeExportFileName(conversation.title);
  const path = await uniquePath(app, folder, baseName);

  const file = await app.vault.create(path, markdown);

  if (options.open !== false) {
    await app.workspace.getLeaf('tab').openFile(file);
  }
  new Notice(`Konversation exportiert: ${file.path}`);
  return file;
}

/** Creates a folder (and parents) if it does not exist. */
async function ensureFolder(app: App, folder: string): Promise<void> {
  if (!folder) return;
  const existing = app.vault.getAbstractFileByPath(folder);
  if (existing) return;
  try {
    await app.vault.createFolder(folder);
  } catch {
    // Folder may have been created concurrently — ignore.
  }
}

/** Returns a non-colliding `.md` path under the folder for the given base name. */
async function uniquePath(app: App, folder: string, baseName: string): Promise<string> {
  const prefix = folder ? `${folder}/` : '';
  let candidate = normalizePath(`${prefix}${baseName}.md`);
  if (!(app.vault.getAbstractFileByPath(candidate) instanceof TFile)) return candidate;
  for (let i = 2; i < 1000; i++) {
    candidate = normalizePath(`${prefix}${baseName} ${i}.md`);
    if (!(app.vault.getAbstractFileByPath(candidate) instanceof TFile)) return candidate;
  }
  // Extreme fallback: append the message count + length to force uniqueness.
  return normalizePath(`${prefix}${baseName} ${baseName.length}-${Date.now() % 100000}.md`);
}
