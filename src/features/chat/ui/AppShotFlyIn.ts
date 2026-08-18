import type { FrontmostWindow } from '../services/appShotCapture';

const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)';

export interface AppShotFlyInOptions {
  png: Buffer;
  bounds: FrontmostWindow;
  targetEl: HTMLElement | null;
  ownerDocument?: Document;
  reduceMotion?: boolean;
  dataUri?: string;
}

function dataUri(png: Buffer): string {
  return `data:image/png;base64,${png.toString('base64')}`;
}

function playShutter(ownerDocument: Document): void {
  const AudioCtx = ownerDocument.defaultView?.AudioContext
    ?? (ownerDocument.defaultView as unknown as { webkitAudioContext?: typeof AudioContext })?.webkitAudioContext;
  if (!AudioCtx) return;
  const ctx = new AudioCtx();
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = 'triangle';
  oscillator.frequency.setValueAtTime(1240, ctx.currentTime);
  oscillator.frequency.exponentialRampToValueAtTime(420, ctx.currentTime + 0.09);
  gain.gain.setValueAtTime(0.06, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start();
  oscillator.stop(ctx.currentTime + 0.13);
  window.setTimeout(() => void ctx.close(), 180);
}

/**
 * Flies the captured window thumbnail from its screen rect into the chat
 * composer. Spatial consistency: the shot leaves the captured app and docks
 * as a chip. Occasional action — 180ms ease-out, opacity+transform only.
 */
export function playAppShotFlyIn(options: AppShotFlyInOptions): Promise<void> {
  const ownerDocument = options.ownerDocument ?? window.document;
  const reduceMotion = options.reduceMotion
    ?? ownerDocument.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    ?? false;

  const overlay = ownerDocument.body.createDiv({ cls: 'claudian-appshot-fly' });
  const card = overlay.createDiv({ cls: 'claudian-appshot-fly-card' });
  const img = card.createEl('img', { cls: 'claudian-appshot-fly-image' });
  img.src = options.dataUri ?? dataUri(options.png);
  img.alt = options.bounds.appName;

  const fromW = Math.max(160, Math.min(options.bounds.width, ownerDocument.documentElement.clientWidth * 0.62));
  const fromH = Math.max(110, Math.min(options.bounds.height, ownerDocument.documentElement.clientHeight * 0.62));
  const fromX = Math.max(16, Math.min(options.bounds.x, ownerDocument.documentElement.clientWidth - fromW - 16));
  const fromY = Math.max(16, Math.min(options.bounds.y, ownerDocument.documentElement.clientHeight - fromH - 16));

  const dest = options.targetEl?.getBoundingClientRect();
  const toW = dest ? Math.max(48, Math.min(dest.width, 168)) : 72;
  const toH = dest ? Math.max(48, Math.min(dest.height, 168)) : 72;
  const toX = dest ? dest.left + dest.width / 2 - toW / 2 : ownerDocument.documentElement.clientWidth - 96;
  const toY = dest ? dest.top + dest.height / 2 - toH / 2 : ownerDocument.documentElement.clientHeight - 120;

  const scaleTo = Math.max(0.18, Math.min(toW / fromW, toH / fromH));
  card.setCssProps({
    width: `${fromW}px`,
    height: `${fromH}px`,
    transform: `translate(${fromX}px, ${fromY}px) scale(0.96)`,
    opacity: '0.88',
  });

  const finish = () => overlay.remove();

  if (reduceMotion || typeof card.animate !== 'function') {
    window.setTimeout(finish, 160);
    return Promise.resolve();
  }

  const animation = card.animate(
    [
      {
        transform: `translate(${fromX}px, ${fromY}px) scale(0.96)`,
        opacity: 0.88,
      },
      {
        transform: `translate(${toX}px, ${toY}px) scale(${scaleTo})`,
        opacity: 1,
      },
    ],
    { duration: 180, easing: EASE_OUT, fill: 'forwards' },
  );

  return new Promise((resolve) => {
    const done = () => {
      finish();
      resolve();
    };
    animation.addEventListener('finish', done);
    window.setTimeout(done, 220);
  });
}

export function playAppShotSound(play: boolean, ownerDocument: Document = window.document): void {
  if (!play) return;
  try {
    playShutter(ownerDocument);
  } catch {
    // AudioContext can fail before a user gesture on some hosts.
  }
}
