/**
 * Library thumbnails. The format badge is always rendered first and stays
 * underneath: it is the placeholder while an image loads and the fallback when
 * it fails, so a row never changes size.
 */

import { attachmentTypeMeta } from '../file-drop/attachmentMeta';
import { isRasterPeekSrc } from '../file-drop/pdfPeek';
import type { LibraryItem } from './libraryItem';

export type ThumbnailPlan =
  | { type: 'image'; src: string }
  | { type: 'pdf'; path: string }
  | { type: 'none' };

export type ThumbnailState = 'none' | 'pending' | 'loading' | 'loaded' | 'failed';

export interface ThumbnailSlot {
  /** Fixed-size box holding the badge; carries the state in `data-thumb`. */
  mediaEl: HTMLElement;
  plan: ThumbnailPlan;
}

export interface ThumbnailLoaderDeps {
  /** The panel's own window (popouts have their own constructors). */
  win: { IntersectionObserver?: typeof IntersectionObserver } | null;
  /** Scroll container used as the visibility root. */
  root: HTMLElement | null;
  loadPdfPeek: (path: string) => Promise<string | null>;
}

export const THUMB_SIZE_PX = 40;
/** Rows just below the fold start loading so scrolling does not reveal blanks. */
const PRELOAD_MARGIN = '160px 0px';
/** Peeks are data URIs of ~50–150 KB; keep a bounded number around. */
const MAX_CACHED_PEEKS = 48;
const NONE: ThumbnailPlan = { type: 'none' };

export function planLibraryThumbnail(
  item: LibraryItem,
  resolveResourcePath: (relPath: string) => string | null,
): ThumbnailPlan {
  if (item.type === 'live') return NONE;
  const { kind } = attachmentTypeMeta(item.name);
  if (kind === 'image') {
    const src = item.previewSrc
      ?? (item.relPath.startsWith('data:image') ? item.relPath : resolveResourcePath(item.relPath));
    return src ? { type: 'image', src } : NONE;
  }
  if (kind !== 'pdf') return NONE;
  // Vault files carry their own resource URL as previewSrc; for a PDF that is
  // the document, not a picture, so only a raster peek counts.
  if (item.previewSrc && isRasterPeekSrc(item.previewSrc)) return { type: 'image', src: item.previewSrc };
  return item.relPath.startsWith('data:') ? NONE : { type: 'pdf', path: item.relPath };
}

export function thumbnailState(mediaEl: HTMLElement): ThumbnailState {
  return (mediaEl.getAttribute('data-thumb') as ThumbnailState | null) ?? 'none';
}

function setThumbnailState(mediaEl: HTMLElement, state: ThumbnailState): void {
  mediaEl.setAttribute('data-thumb', state);
}

export function markThumbnailFailed(mediaEl: HTMLElement, img: HTMLImageElement): void {
  img.remove();
  setThumbnailState(mediaEl, 'failed');
}

/** Places a lazily decoded image over the badge. */
export function showThumbnail(mediaEl: HTMLElement, src: string): HTMLImageElement {
  const size = String(THUMB_SIZE_PX);
  const img = mediaEl.createEl('img', {
    cls: 'claudian-preview-thumb',
    attr: { alt: '', width: size, height: size, loading: 'lazy', decoding: 'async', draggable: 'false' },
  });
  setThumbnailState(mediaEl, 'loading');
  img.addEventListener('load', () => setThumbnailState(mediaEl, 'loaded'), { once: true });
  img.addEventListener('error', () => markThumbnailFailed(mediaEl, img), { once: true });
  img.setAttribute('src', src);
  return img;
}

/**
 * Loads thumbnails only for rows the panel asks for — open panel, row visible
 * under the current filter — and, where IntersectionObserver exists, only once
 * the row nears the viewport. PDF peeks are generated one at a time.
 */
export class LibraryThumbnailLoader {
  private observer: IntersectionObserver | null = null;
  private readonly observed = new Map<Element, ThumbnailSlot>();
  private readonly peeks = new Map<string, Promise<string | null>>();
  private queue: Promise<unknown> = Promise.resolve();
  private destroyed = false;

  constructor(private readonly deps: ThumbnailLoaderDeps) {}

  request(slot: ThumbnailSlot): void {
    if (this.destroyed || slot.plan.type === 'none') return;
    if (thumbnailState(slot.mediaEl) !== 'pending' || this.observed.has(slot.mediaEl)) return;
    const observer = this.ensureObserver();
    if (!observer) {
      this.load(slot);
      return;
    }
    this.observed.set(slot.mediaEl, slot);
    observer.observe(slot.mediaEl);
  }

  destroy(): void {
    this.destroyed = true;
    this.observer?.disconnect();
    this.observer = null;
    this.observed.clear();
    this.peeks.clear();
  }

  private ensureObserver(): IntersectionObserver | null {
    if (this.observer) return this.observer;
    const Observer = this.deps.win?.IntersectionObserver;
    if (typeof Observer !== 'function') return null;
    this.observer = new Observer((entries: IntersectionObserverEntry[]) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const slot = this.observed.get(entry.target);
        if (!slot) continue;
        this.observed.delete(entry.target);
        this.observer?.unobserve(entry.target);
        this.load(slot);
      }
    }, { root: this.deps.root, rootMargin: PRELOAD_MARGIN });
    return this.observer;
  }

  private load(slot: ThumbnailSlot): void {
    const { plan, mediaEl } = slot;
    if (plan.type === 'image') {
      showThumbnail(mediaEl, plan.src);
      return;
    }
    if (plan.type !== 'pdf') return;
    setThumbnailState(mediaEl, 'loading');
    void this.peekFor(plan.path).then((src) => {
      if (this.destroyed) return;
      if (src) showThumbnail(mediaEl, src);
      else setThumbnailState(mediaEl, 'none');
    });
  }

  private peekFor(path: string): Promise<string | null> {
    const cached = this.peeks.get(path);
    if (cached) return cached;
    const peek = this.queue
      .then(() => this.deps.loadPdfPeek(path))
      .catch(() => null);
    this.queue = peek;
    this.peeks.set(path, peek);
    if (this.peeks.size > MAX_CACHED_PEEKS) {
      const oldest = this.peeks.keys().next().value;
      if (oldest !== undefined) this.peeks.delete(oldest);
    }
    return peek;
  }
}
