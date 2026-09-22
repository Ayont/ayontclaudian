import { ComposerDraftStore, conversationDraftKey, tabDraftKey } from '@/features/chat/services/ComposerDraftStore';
import { composerDraftKeyForTab, restoreComposerDraft } from '@/features/chat/tabs/composerDraftTab';

function createFakeTab(conversationId: string | null = 'conv-1') {
  const attachedImages: { id: string }[] = [];
  const attachments: { name: string; relPath: string; size: number }[] = [];
  const inputEl = { value: '', dispatchEvent: jest.fn() };
  const imageContextManager = {
    getAttachedImages: () => attachedImages,
    getDraftAttachments: () => attachments,
    restoreDraftAttachments: jest.fn((list: { name: string; relPath: string; size?: number }[]) => {
      attachments.push(...list.map(a => ({ ...a, size: a.size ?? 0 })));
    }),
    addRestoredImages: jest.fn((images: { id: string }[]) => {
      attachedImages.push(...images);
    }),
  };
  const tab = {
    id: 'tab-1',
    conversationId,
    dom: { inputEl },
    ui: { imageContextManager },
  };
  return { tab: tab as any, inputEl, imageContextManager };
}

function createPlugin(store: ComposerDraftStore, images: Record<string, { id: string }> = {}) {
  return {
    composerDrafts: store,
    imageStagingService: {
      loadImages: jest.fn(async (ids: string[]) => new Map(ids.filter(id => images[id]).map(id => [id, images[id]]))),
    },
  } as any;
}

describe('composerDraftTab', () => {
  it('keys a bound tab by its conversation and a blank tab by itself', () => {
    expect(composerDraftKeyForTab({ id: 't', conversationId: 'c' })).toBe(conversationDraftKey('c'));
    expect(composerDraftKeyForTab({ id: 't', conversationId: null })).toBe(tabDraftKey('t'));
  });

  it('puts text, file chips and staged images back into an empty composer', async () => {
    const store = new ComposerDraftStore(null);
    store.set(conversationDraftKey('conv-1'), {
      text: 'Bitte das Angebot prüfen',
      attachments: [{ name: 'Angebot.pdf', relPath: '.claudian/attachments/angebot.pdf', size: 900 }],
      imageIds: ['img-1', 'img-gone'],
    });
    const { tab, inputEl, imageContextManager } = createFakeTab();
    const plugin = createPlugin(store, { 'img-1': { id: 'img-1' } });

    await restoreComposerDraft(tab, plugin);

    expect(inputEl.value).toBe('Bitte das Angebot prüfen');
    expect(inputEl.dispatchEvent).toHaveBeenCalled();
    expect(imageContextManager.restoreDraftAttachments).toHaveBeenCalledWith([
      { name: 'Angebot.pdf', relPath: '.claudian/attachments/angebot.pdf', size: 900 },
    ]);
    // An image whose staged bytes were cleaned up is skipped, not an error.
    expect(imageContextManager.addRestoredImages).toHaveBeenCalledWith([{ id: 'img-1' }]);
  });

  it('never overwrites what is already in the composer', async () => {
    const store = new ComposerDraftStore(null);
    store.set(conversationDraftKey('conv-1'), { text: 'alt', attachments: [], imageIds: [] });
    const { tab, inputEl } = createFakeTab();
    inputEl.value = 'gerade getippt';

    await restoreComposerDraft(tab, createPlugin(store));

    expect(inputEl.value).toBe('gerade getippt');
  });

  it('does nothing when the chat has no draft', async () => {
    const { tab, inputEl, imageContextManager } = createFakeTab();

    await restoreComposerDraft(tab, createPlugin(new ComposerDraftStore(null)));

    expect(inputEl.value).toBe('');
    expect(imageContextManager.restoreDraftAttachments).not.toHaveBeenCalled();
  });

  it('keeps images out of a chat the tab has already left', async () => {
    const store = new ComposerDraftStore(null);
    store.set(conversationDraftKey('conv-1'), { text: '', attachments: [], imageIds: ['img-1'] });
    const { tab, imageContextManager } = createFakeTab();
    const plugin = createPlugin(store, { 'img-1': { id: 'img-1' } });
    plugin.imageStagingService.loadImages.mockImplementation(async () => {
      tab.conversationId = 'conv-2';
      return new Map([['img-1', { id: 'img-1' }]]);
    });

    await restoreComposerDraft(tab, plugin);

    expect(imageContextManager.addRestoredImages).not.toHaveBeenCalled();
  });
});
