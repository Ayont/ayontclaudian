import { createMockEl } from '@test/helpers/mockElement';

import { createAppShotFlash } from '@/features/chat/ui/AppShotFlash';

function mockDocument() {
  const body = createMockEl('body');
  return {
    body,
    defaultView: {
      matchMedia: () => ({ matches: false }),
      requestAnimationFrame: (callback: FrameRequestCallback) => Number(setTimeout(() => callback(Date.now()), 0)),
    },
  } as unknown as Document;
}

describe('createAppShotFlash', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('attaches a full-screen white layer to the document', () => {
    const ownerDocument = mockDocument();
    const flash = createAppShotFlash({
      ownerDocument,
      reduceMotion: true,
      coverScreen: () => () => undefined,
    });

    flash.attach();

    const el = ownerDocument.body.querySelector('.claudian-appshot-flash');
    expect(el).toBeTruthy();
    expect(el?.getAttribute('aria-hidden')).toBe('true');
    flash.dismiss();
  });

  it('covers the screen immediately and releases the cover on dismiss', () => {
    const release = jest.fn();
    const coverScreen = jest.fn(() => release);
    const flash = createAppShotFlash({
      ownerDocument: mockDocument(),
      coverScreen,
    });

    flash.cover();
    expect(coverScreen).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalled();

    flash.dismiss();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('fades the layer out after Obsidian is covered, then removes it', async () => {
    jest.useFakeTimers();
    const release = jest.fn();
    const ownerDocument = mockDocument();
    const flash = createAppShotFlash({
      ownerDocument,
      reduceMotion: true,
      coverScreen: () => release,
    });

    flash.cover();
    flash.attach();
    const el = ownerDocument.body.querySelector('.claudian-appshot-flash');
    const remove = jest.fn();
    if (el) el.remove = remove;

    const done = flash.fadeOut();
    await jest.advanceTimersByTimeAsync(400);
    await done;

    expect(el?.classList.contains('is-fading')).toBe(true);
    expect(release).toHaveBeenCalled();
    expect(remove).toHaveBeenCalled();
  });

  it('is safe to fade or dismiss twice', async () => {
    jest.useFakeTimers();
    const release = jest.fn();
    const flash = createAppShotFlash({
      ownerDocument: mockDocument(),
      reduceMotion: true,
      coverScreen: () => release,
    });

    flash.cover();
    flash.attach();
    const first = flash.fadeOut();
    await jest.advanceTimersByTimeAsync(400);
    await first;
    await flash.fadeOut();
    flash.dismiss();
    expect(release).toHaveBeenCalledTimes(1);
  });
});
