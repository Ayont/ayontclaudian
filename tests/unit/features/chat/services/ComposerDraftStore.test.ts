import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  ComposerDraftStore,
  conversationDraftKey,
  MAX_DRAFT_TEXT_LENGTH,
  tabDraftKey,
} from '@/features/chat/services/ComposerDraftStore';

describe('ComposerDraftStore', () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'claudian-drafts-'));
    file = path.join(dir, 'composer-drafts.json');
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  const withText = (text: string) => ({ text, attachments: [], imageIds: [] });

  it('stores and returns a draft by key', () => {
    const store = new ComposerDraftStore(file);

    store.set(conversationDraftKey('conv-1'), withText('Hallo'));

    expect(store.get(conversationDraftKey('conv-1'))?.text).toBe('Hallo');
    expect(store.get(conversationDraftKey('conv-2'))).toBeNull();
  });

  it('treats an empty composer as no draft', () => {
    const store = new ComposerDraftStore(file);
    const key = conversationDraftKey('conv-1');
    store.set(key, withText('Hallo'));

    store.set(key, { text: '   \n', attachments: [], imageIds: [] });

    expect(store.get(key)).toBeNull();
  });

  it('keeps a draft that holds only attachments or images', () => {
    const store = new ComposerDraftStore(file);

    store.set(tabDraftKey('tab-1'), { text: '', attachments: [{ name: 'Angebot.pdf', relPath: '.claudian/attachments/a.pdf' }], imageIds: [] });
    store.set(tabDraftKey('tab-2'), { text: '', attachments: [], imageIds: ['img-1'] });

    expect(store.get(tabDraftKey('tab-1'))?.attachments).toHaveLength(1);
    expect(store.get(tabDraftKey('tab-2'))?.imageIds).toEqual(['img-1']);
  });

  it('caps very long text', () => {
    const store = new ComposerDraftStore(file);

    store.set(tabDraftKey('tab-1'), withText('x'.repeat(MAX_DRAFT_TEXT_LENGTH + 50)));

    expect(store.get(tabDraftKey('tab-1'))?.text).toHaveLength(MAX_DRAFT_TEXT_LENGTH);
  });

  it('moves a blank-tab draft onto the conversation it becomes', () => {
    const store = new ComposerDraftStore(file);
    store.set(tabDraftKey('tab-1'), withText('Entwurf'));

    store.move(tabDraftKey('tab-1'), conversationDraftKey('conv-9'));

    expect(store.get(tabDraftKey('tab-1'))).toBeNull();
    expect(store.get(conversationDraftKey('conv-9'))?.text).toBe('Entwurf');
  });

  it('reports which conversations hold a draft', () => {
    const store = new ComposerDraftStore(file);
    store.set(conversationDraftKey('conv-1'), withText('a'));
    store.set(tabDraftKey('tab-1'), withText('b'));

    expect(store.hasConversationDraft('conv-1')).toBe(true);
    expect(store.hasConversationDraft('conv-2')).toBe(false);
    expect(store.has(tabDraftKey('tab-1'))).toBe(true);
  });

  it('notifies listeners only when a key gains or loses its draft', () => {
    const store = new ComposerDraftStore(file);
    const listener = jest.fn();
    store.subscribe(listener);
    const key = conversationDraftKey('conv-1');

    store.set(key, withText('H'));
    store.set(key, withText('Ha'));
    store.set(key, withText('Hal'));
    store.delete(key);

    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('survives a reload from disk after flush', async () => {
    const store = new ComposerDraftStore(file);
    store.set(conversationDraftKey('conv-1'), { text: 'Frage', attachments: [{ name: 'a.pdf', relPath: 'x/a.pdf', size: 12 }], imageIds: ['img-1'] });
    await store.flush();

    const reloaded = new ComposerDraftStore(file);
    await reloaded.load();

    expect(reloaded.get(conversationDraftKey('conv-1'))).toMatchObject({
      text: 'Frage',
      attachments: [{ name: 'a.pdf', relPath: 'x/a.pdf', size: 12 }],
      imageIds: ['img-1'],
    });
  });

  it('writes on its own after the debounce, without an explicit flush', async () => {
    const store = new ComposerDraftStore(file, { debounceMs: 10 });
    store.set(tabDraftKey('tab-1'), withText('später'));

    await new Promise(resolve => setTimeout(resolve, 80));

    const reloaded = new ComposerDraftStore(file);
    await reloaded.load();
    expect(reloaded.get(tabDraftKey('tab-1'))?.text).toBe('später');
  });

  it('ignores a corrupt file and malformed entries on load', async () => {
    await fs.writeFile(file, JSON.stringify({
      version: 1,
      drafts: {
        'conversation:ok': { text: 'gut', attachments: [{ name: 'a', relPath: 'b' }, { name: 1 }], imageIds: ['i', 7], updatedAt: 1 },
        'conversation:bad': 'kein Objekt',
      },
    }));
    const store = new ComposerDraftStore(file);
    await store.load();

    expect(store.get('conversation:ok')).toMatchObject({ text: 'gut', attachments: [{ name: 'a', relPath: 'b' }], imageIds: ['i'] });
    expect(store.get('conversation:bad')).toBeNull();

    await fs.writeFile(file, '{"drafts": {');
    const broken = new ComposerDraftStore(file);
    await expect(broken.load()).resolves.toBeUndefined();
    expect(broken.hasConversationDraft('ok')).toBe(false);
  });

  it('works in memory when there is no file path', async () => {
    const store = new ComposerDraftStore(null);
    store.set(tabDraftKey('tab-1'), withText('nur im Speicher'));

    await expect(store.flush()).resolves.toBeUndefined();
    expect(store.get(tabDraftKey('tab-1'))?.text).toBe('nur im Speicher');
  });
});
