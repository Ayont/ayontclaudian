/**
 * ChatGPT-style camera flash for App Shots: cover the display white so the
 * app-switch is hidden, then fade the white once Obsidian is in front.
 *
 * Occasional action. Purpose: prevent a jarring change + shutter feedback.
 * Opacity only, ease-out, token durations.
 */

export const APP_SHOT_FLASH_HOLD_MS = 80;
export const APP_SHOT_FLASH_FADE_MS = 320;
export const APP_SHOT_FLASH_REDUCED_FADE_MS = 120;

export interface AppShotFlash {
  cover(): void;
  attach(ownerDocument?: Document): void;
  fadeOut(): Promise<void>;
  dismiss(): void;
}

export interface CreateAppShotFlashOptions {
  ownerDocument?: Document;
  reduceMotion?: boolean;
  coverScreen?: () => (() => void) | void;
}

interface OverlayWindow {
  destroy: () => void;
  setAlwaysOnTop?: (flag: boolean, level?: string, relativeLevel?: number) => void;
  setIgnoreMouseEvents?: (ignore: boolean) => void;
  setVisibleOnAllWorkspaces?: (visible: boolean, opts?: { visibleOnFullScreen?: boolean }) => void;
}

interface DisplayBounds {
  bounds: { x: number; y: number; width: number; height: number };
}

function prefersReducedMotion(ownerDocument: Document): boolean {
  return ownerDocument.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

function nextFrame(ownerDocument: Document): Promise<void> {
  const view = ownerDocument.defaultView;
  if (!view?.requestAnimationFrame) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    view.requestAnimationFrame(() => resolve());
  });
}

function wait(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function waitForFade(el: HTMLElement, ms: number): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      el.removeEventListener('transitionend', onEnd);
      resolve();
    };
    const onEnd = (event: TransitionEvent) => {
      if (event.propertyName === 'opacity') done();
    };
    el.addEventListener('transitionend', onEnd);
    window.setTimeout(done, ms + 40);
  });
}

/** Fullscreen always-on-top white windows so the previous app never flashes through. */
export function tryCoverDisplaysWhite(): () => void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Electron is only in the Obsidian renderer.
    const electron = require('electron') as {
      remote?: {
        BrowserWindow?: new (opts: Record<string, unknown>) => OverlayWindow;
        screen?: { getAllDisplays: () => DisplayBounds[] };
      };
    };
    const BrowserWindow = electron.remote?.BrowserWindow;
    const screen = electron.remote?.screen;
    if (!BrowserWindow || !screen) return () => undefined;

    const windows = screen.getAllDisplays().map((display) => {
      const win = new BrowserWindow({
        x: display.bounds.x,
        y: display.bounds.y,
        width: display.bounds.width,
        height: display.bounds.height,
        frame: false,
        transparent: false,
        backgroundColor: '#ffffff',
        alwaysOnTop: true,
        skipTaskbar: true,
        focusable: false,
        fullscreenable: false,
        hasShadow: false,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        show: true,
        enableLargerThanScreen: true,
        webPreferences: { sandbox: true },
      });
      win.setAlwaysOnTop?.(true, 'screen-saver', 1);
      win.setIgnoreMouseEvents?.(true);
      win.setVisibleOnAllWorkspaces?.(true, { visibleOnFullScreen: true });
      return win;
    });

    return () => {
      for (const win of windows) {
        try {
          win.destroy();
        } catch {
          // Window may already be gone.
        }
      }
    };
  } catch {
    return () => undefined;
  }
}

function defaultDocument(explicit?: Document): Document | undefined {
  if (explicit) return explicit;
  const view = typeof window === 'undefined'
    ? undefined
    : window as Window & { activeDocument?: Document };
  return view?.activeDocument ?? view?.document;
}

export function createAppShotFlash(options: CreateAppShotFlashOptions = {}): AppShotFlash {
  const ownerDocument = defaultDocument(options.ownerDocument);
  const coverScreen = options.coverScreen ?? tryCoverDisplaysWhite;
  const reduceMotion = options.reduceMotion
    ?? (ownerDocument ? prefersReducedMotion(ownerDocument) : false);

  let el: HTMLElement | null = null;
  let releaseScreen: (() => void) | null = null;
  let finished = false;

  const releaseCover = () => {
    releaseScreen?.();
    releaseScreen = null;
  };

  return {
    cover() {
      if (finished || releaseScreen) return;
      releaseScreen = coverScreen() ?? (() => undefined);
    },

    attach(doc = ownerDocument) {
      if (finished || el || !doc?.body) return;
      el = doc.body.createDiv({ cls: 'claudian-appshot-flash' });
      el.setAttribute('aria-hidden', 'true');
    },

    async fadeOut() {
      if (finished) return;
      finished = true;
      const layer = el;
      const fadeMs = reduceMotion ? APP_SHOT_FLASH_REDUCED_FADE_MS : APP_SHOT_FLASH_FADE_MS;
      const holdMs = reduceMotion ? 0 : APP_SHOT_FLASH_HOLD_MS;
      const doc = layer?.ownerDocument ?? ownerDocument;

      // Paint the Obsidian overlay first so dropping the OS cover stays white.
      if (doc) await nextFrame(doc);
      releaseCover();
      if (!layer) return;

      if (holdMs) await wait(holdMs);
      void layer.offsetWidth;
      layer.classList.add('is-fading');
      await waitForFade(layer, fadeMs);
      layer.remove();
      if (el === layer) el = null;
    },

    dismiss() {
      finished = true;
      releaseCover();
      el?.remove();
      el = null;
    },
  };
}
