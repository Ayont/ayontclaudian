/** @jest-environment jsdom */

import type { LibraryItem } from '@/features/chat/ui/library/libraryItem';
import {
  LibraryThumbnailLoader,
  markThumbnailFailed,
  planLibraryThumbnail,
  showThumbnail,
  THUMB_SIZE_PX,
  type ThumbnailPlan,
  thumbnailState,
} from '@/features/chat/ui/library/libraryThumbnails';

function installObsidianDomHelpers(): void {
  (HTMLElement.prototype as any).createEl = function createEl(
    tag: string,
    options?: { cls?: string; text?: string; attr?: Record<string, string> },
  ) {
    const element = document.createElement(tag);
    if (options?.cls) element.className = options.cls;
    if (options?.text) element.textContent = options.text;
    for (const [key, value] of Object.entries(options?.attr ?? {})) element.setAttribute(key, value);
    this.appendChild(element);
    return element;
  };
}

const upload = (name: string, relPath: string, previewSrc?: string): LibraryItem => ({
  id: `upload:${relPath}`,
  type: 'upload',
  name,
  relPath,
  ...(previewSrc ? { previewSrc } : {}),
});

const resolve = jest.fn((relPath: string) => `app://vault/${relPath}`);

function mediaFor(plan: ThumbnailPlan): HTMLElement {
  const media = document.createElement('span');
  media.setAttribute('data-thumb', plan.type === 'none' ? 'none' : 'pending');
  media.appendChild(document.createElement('span')).className = 'claudian-preview-row-icon';
  return media;
}

describe('planLibraryThumbnail', () => {
  it('uses the vault resource URL for image files', () => {
    expect(planLibraryThumbnail(upload('foto.png', 'Bilder/foto.png'), resolve)).toEqual({
      type: 'image',
      src: 'app://vault/Bilder/foto.png',
    });
    expect(planLibraryThumbnail(upload('foto.png', 'Bilder/foto.png', 'app://cached/foto.png'), resolve)).toEqual({
      type: 'image',
      src: 'app://cached/foto.png',
    });
  });

  it('falls back to the badge when an image path cannot be resolved', () => {
    expect(planLibraryThumbnail(upload('foto.png', 'Bilder/foto.png'), () => null)).toEqual({ type: 'none' });
  });

  it('reuses a raster PDF peek but never shows the PDF itself as an image', () => {
    expect(planLibraryThumbnail(upload('a.pdf', 'Docs/a.pdf', 'data:image/jpeg;base64,AAA'), resolve)).toEqual({
      type: 'image',
      src: 'data:image/jpeg;base64,AAA',
    });
    expect(planLibraryThumbnail(upload('a.pdf', 'Docs/a.pdf', 'app://vault/Docs/a.pdf?1'), resolve)).toEqual({
      type: 'pdf',
      path: 'Docs/a.pdf',
    });
  });

  it('keeps the format badge for documents, sheets and live documents', () => {
    expect(planLibraryThumbnail(upload('Budget.xlsx', 'Finanzen/Budget.xlsx'), resolve)).toEqual({ type: 'none' });
    expect(planLibraryThumbnail({
      id: 'live:x',
      type: 'live',
      liveDocument: { title: 'Plan', theme: 'business', body: '# Plan' },
      theme: 'business',
    }, resolve)).toEqual({ type: 'none' });
  });
});

describe('thumbnail image fallback', () => {
  beforeAll(installObsidianDomHelpers);

  it('lazy-loads a fixed-size image over the badge', () => {
    const media = mediaFor({ type: 'image', src: 'data:image/png;base64,AAA' });
    const img = showThumbnail(media, 'data:image/png;base64,AAA');

    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.getAttribute('decoding')).toBe('async');
    expect(img.getAttribute('width')).toBe(String(THUMB_SIZE_PX));
    expect(img.getAttribute('height')).toBe(String(THUMB_SIZE_PX));
    expect(img.getAttribute('alt')).toBe('');
    expect(thumbnailState(media)).toBe('loading');

    img.dispatchEvent(new Event('load'));
    expect(thumbnailState(media)).toBe('loaded');
  });

  it('removes a broken image and leaves the badge in place', () => {
    const media = mediaFor({ type: 'image', src: 'missing.png' });
    const img = showThumbnail(media, 'app://vault/missing.png');

    img.dispatchEvent(new Event('error'));

    expect(media.querySelector('img')).toBeNull();
    expect(media.querySelector('.claudian-preview-row-icon')).not.toBeNull();
    expect(thumbnailState(media)).toBe('failed');
    markThumbnailFailed(media, img);
    expect(thumbnailState(media)).toBe('failed');
  });
});

describe('LibraryThumbnailLoader', () => {
  beforeAll(installObsidianDomHelpers);

  it('loads a requested image immediately when IntersectionObserver is unavailable', () => {
    const loader = new LibraryThumbnailLoader({ win: null, root: null, loadPdfPeek: jest.fn() });
    const plan: ThumbnailPlan = { type: 'image', src: 'data:image/png;base64,AAA' };
    const media = mediaFor(plan);

    loader.request({ mediaEl: media, plan });

    expect(media.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,AAA');
  });

  it('waits for a row to scroll into view before loading', () => {
    const observed: Element[] = [];
    let callback: (entries: Array<{ target: Element; isIntersecting: boolean }>) => void = () => {};
    const win = {
      IntersectionObserver: class {
        constructor(cb: typeof callback) { callback = cb; }
        observe(target: Element) { observed.push(target); }
        unobserve() {}
        disconnect() {}
      },
    } as unknown as { IntersectionObserver: typeof IntersectionObserver };
    const loader = new LibraryThumbnailLoader({ win, root: document.createElement('div'), loadPdfPeek: jest.fn() });
    const plan: ThumbnailPlan = { type: 'image', src: 'data:image/png;base64,AAA' };
    const media = mediaFor(plan);

    loader.request({ mediaEl: media, plan });
    expect(observed).toEqual([media]);
    expect(media.querySelector('img')).toBeNull();

    callback([{ target: media, isIntersecting: true }]);
    expect(media.querySelector('img')).not.toBeNull();
  });

  it('leaves badge-only rows untouched', () => {
    const loadPdfPeek = jest.fn();
    const loader = new LibraryThumbnailLoader({ win: null, root: null, loadPdfPeek });
    const plan: ThumbnailPlan = { type: 'none' };
    const media = mediaFor(plan);

    loader.request({ mediaEl: media, plan });

    expect(loadPdfPeek).not.toHaveBeenCalled();
    expect(media.querySelector('img')).toBeNull();
    expect(thumbnailState(media)).toBe('none');
  });

  it('generates a PDF peek once per path and keeps the badge when none exists', async () => {
    const loadPdfPeek = jest.fn()
      .mockResolvedValueOnce('data:image/png;base64,PEEK')
      .mockResolvedValueOnce(null);
    const loader = new LibraryThumbnailLoader({ win: null, root: null, loadPdfPeek });
    const first: ThumbnailPlan = { type: 'pdf', path: 'Docs/a.pdf' };
    const again = mediaFor(first);
    const media = mediaFor(first);
    const other = mediaFor({ type: 'pdf', path: 'Docs/b.pdf' });

    loader.request({ mediaEl: media, plan: first });
    loader.request({ mediaEl: again, plan: first });
    loader.request({ mediaEl: other, plan: { type: 'pdf', path: 'Docs/b.pdf' } });
    await new Promise((resolveTick) => setTimeout(resolveTick, 0));

    expect(loadPdfPeek).toHaveBeenCalledTimes(2);
    expect(media.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,PEEK');
    expect(again.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,PEEK');
    expect(other.querySelector('img')).toBeNull();
    expect(thumbnailState(other)).toBe('none');
  });

  it('does not request the same row twice', () => {
    const loader = new LibraryThumbnailLoader({ win: null, root: null, loadPdfPeek: jest.fn() });
    const plan: ThumbnailPlan = { type: 'image', src: 'data:image/png;base64,AAA' };
    const media = mediaFor(plan);

    loader.request({ mediaEl: media, plan });
    loader.request({ mediaEl: media, plan });

    expect(media.querySelectorAll('img')).toHaveLength(1);
  });
});
