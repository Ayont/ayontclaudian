import type { LiveDocument, LiveDocumentTheme } from '../../rendering/LiveDocumentRenderer';
import { attachmentTypeMeta } from '../file-drop/attachmentMeta';
import { parentFolder } from '../file-drop/vaultAttachment';
import type { LibraryKind } from './libraryIndex';

export type LibraryItem =
  | { id: string; type: 'upload'; name: string; relPath: string; previewSrc?: string }
  | {
    id: string;
    type: 'live';
    liveDocument: LiveDocument;
    theme: LiveDocumentTheme;
    vaultPath?: string;
  };

/** What a row shows and what search indexes for one library item. */
export interface LibraryItemDetails {
  name: string;
  /** Vault path the row actions operate on. */
  path: string;
  folder: string;
  kind: LibraryKind;
}

export function describeLibraryItem(item: LibraryItem): LibraryItemDetails {
  if (item.type === 'live') {
    const name = item.liveDocument.title;
    const path = item.vaultPath || `.claudian/documents/${name}.md`;
    return { name, path, folder: parentFolder(path), kind: 'document' };
  }
  // A data: URI is not a location; its "folder" would read as `data:image`.
  const folder = item.relPath.startsWith('data:') ? '' : parentFolder(item.relPath);
  return { name: item.name, path: item.relPath, folder, kind: attachmentTypeMeta(item.name).kind };
}
