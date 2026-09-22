import type { ImageAttachment } from '../../../core/types';
import type ClaudianPlugin from '../../../main';
import type { ComposerDraftContent } from '../services/ComposerDraftStore';
import { conversationDraftKey, tabDraftKey } from '../services/ComposerDraftStore';
import { ComposerDraftAutosave } from './composerDraftAutosave';
import type { TabData } from './types';

type DraftTab = Pick<TabData, 'id' | 'conversationId'>;

export function composerDraftKeyForTab(tab: DraftTab): string {
  return tab.conversationId ? conversationDraftKey(tab.conversationId) : tabDraftKey(tab.id);
}

function readComposer(tab: TabData): ComposerDraftContent {
  const images = tab.ui?.imageContextManager;
  return {
    text: tab.dom?.inputEl?.value ?? '',
    attachments: images?.getDraftAttachments?.() ?? [],
    imageIds: images?.getAttachedImages?.().map(image => image.id) ?? [],
  };
}

function composerIsEmpty(tab: TabData): boolean {
  const content = readComposer(tab);
  return !content.text.trim() && content.attachments.length === 0 && content.imageIds.length === 0;
}

/** Starts saving this tab's composer into the plugin's draft store. */
export function attachComposerDraftAutosave(tab: TabData, plugin: ClaudianPlugin): void {
  const store = plugin.composerDrafts;
  if (!store || tab.draftAutosave) return;
  tab.draftAutosave = new ComposerDraftAutosave(store, {
    getKey: () => composerDraftKeyForTab(tab),
    readContent: () => readComposer(tab),
  });
}

/**
 * Puts a saved draft back into an empty composer. Never overwrites something the
 * user already typed, and drops images whose staged bytes are gone.
 */
export async function restoreComposerDraft(tab: TabData, plugin: ClaudianPlugin): Promise<void> {
  const store = plugin.composerDrafts;
  const inputEl = tab.dom?.inputEl;
  if (!store || !inputEl) return;
  const key = composerDraftKeyForTab(tab);
  const draft = store.get(key);
  if (!draft || !composerIsEmpty(tab)) return;

  const images = tab.ui?.imageContextManager;
  if (draft.text) {
    inputEl.value = draft.text;
    // Resizes the textarea and hides the quick-prompt chips, as typing would.
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
  }
  if (draft.attachments.length > 0) {
    images?.restoreDraftAttachments?.(draft.attachments);
  }
  if (draft.imageIds.length === 0 || !images || !plugin.imageStagingService) return;

  const loaded = await plugin.imageStagingService.loadImages(draft.imageIds)
    .catch(() => new Map<string, ImageAttachment>());
  // The tab may have moved to another chat while the bytes were loading.
  if (composerDraftKeyForTab(tab) !== key) return;
  const restored = draft.imageIds
    .map(id => loaded.get(id))
    .filter((image): image is ImageAttachment => !!image);
  if (restored.length > 0) {
    images.addRestoredImages?.(restored);
  }
}
