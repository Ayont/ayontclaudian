import type { ComposerDraftContent } from '@/features/chat/services/ComposerDraftStore';
import { ComposerDraftStore } from '@/features/chat/services/ComposerDraftStore';
import { ComposerDraftAutosave } from '@/features/chat/tabs/composerDraftAutosave';

function createComposer(initialKey: string) {
  let key = initialKey;
  let content: ComposerDraftContent = { text: '', attachments: [], imageIds: [] };
  return {
    source: {
      getKey: () => key,
      readContent: () => content,
    },
    type(text: string) {
      content = { ...content, text };
    },
    switchTo(nextKey: string, nextText = '') {
      key = nextKey;
      content = { text: nextText, attachments: [], imageIds: [] };
    },
  };
}

describe('ComposerDraftAutosave', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('saves the composer after the typing pause', () => {
    const store = new ComposerDraftStore(null);
    const composer = createComposer('conversation:a');
    const autosave = new ComposerDraftAutosave(store, composer.source, 250);

    composer.type('Hallo');
    autosave.schedule();
    expect(store.get('conversation:a')).toBeNull();

    jest.advanceTimersByTime(250);
    expect(store.get('conversation:a')?.text).toBe('Hallo');
  });

  it('flushes the pending text under the key it was typed in', () => {
    const store = new ComposerDraftStore(null);
    const composer = createComposer('conversation:a');
    const autosave = new ComposerDraftAutosave(store, composer.source, 250);
    composer.type('für A');
    autosave.schedule();

    autosave.flushPending();
    composer.switchTo('conversation:b');
    jest.advanceTimersByTime(1000);

    expect(store.get('conversation:a')?.text).toBe('für A');
    expect(store.get('conversation:b')).toBeNull();
  });

  // Regression guard: a debounce that fires after a switch must not read the
  // new chat's (empty) composer and delete that chat's real draft.
  it('never writes a pending save into the chat that is open after a switch', () => {
    const store = new ComposerDraftStore(null);
    store.set('conversation:b', { text: 'Entwurf in B', attachments: [], imageIds: [] });
    const composer = createComposer('conversation:a');
    const autosave = new ComposerDraftAutosave(store, composer.source, 250);
    composer.type('für A');
    autosave.schedule();

    composer.switchTo('conversation:b');
    jest.advanceTimersByTime(250);

    expect(store.get('conversation:b')?.text).toBe('Entwurf in B');
  });

  it('discards the draft once the message is sent', () => {
    const store = new ComposerDraftStore(null);
    const composer = createComposer('conversation:a');
    const autosave = new ComposerDraftAutosave(store, composer.source, 250);
    composer.type('schon gespeichert');
    autosave.flushPending();
    autosave.schedule();

    autosave.discard();
    jest.advanceTimersByTime(250);

    expect(store.get('conversation:a')).toBeNull();
  });

  it('removes the draft when the composer is emptied by hand', () => {
    const store = new ComposerDraftStore(null);
    const composer = createComposer('conversation:a');
    const autosave = new ComposerDraftAutosave(store, composer.source, 250);
    composer.type('weg damit');
    autosave.flushPending();

    composer.type('');
    autosave.schedule();
    jest.advanceTimersByTime(250);

    expect(store.get('conversation:a')).toBeNull();
  });

  it('is a no-op after dispose', () => {
    const store = new ComposerDraftStore(null);
    const composer = createComposer('conversation:a');
    const autosave = new ComposerDraftAutosave(store, composer.source, 250);
    autosave.dispose();

    composer.type('nach dem Schließen');
    autosave.schedule();
    autosave.flushPending();
    jest.advanceTimersByTime(250);

    expect(store.get('conversation:a')).toBeNull();
  });
});
