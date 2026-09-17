import { Notice, setIcon } from 'obsidian';

/**
 * Glass chrome around Obsidian-rendered mermaid (mindmap, flowchart, sequence).
 * Streaming holds the diagram as a pending source card; the final pass lets
 * Obsidian draw SVG once. Matching hashes reuse the previous SVG so a
 * re-render does not flicker.
 */

export type MermaidDiagramKind =
  | 'mindmap'
  | 'flowchart'
  | 'sequence'
  | 'gantt'
  | 'class'
  | 'er'
  | 'state'
  | 'pie'
  | 'timeline'
  | 'git'
  | 'journey'
  | 'unknown';

const KIND_LABELS: Record<MermaidDiagramKind, string> = {
  mindmap: 'Mindmap',
  flowchart: 'Prozess',
  sequence: 'Sequenz',
  gantt: 'Zeitplan',
  class: 'Klassen',
  er: 'Datenmodell',
  state: 'Zustände',
  pie: 'Kreisdiagramm',
  timeline: 'Zeitstrahl',
  git: 'Git',
  journey: 'Journey',
  unknown: 'Diagramm',
};

const KIND_MATCHERS: Array<{ kind: MermaidDiagramKind; pattern: RegExp }> = [
  { kind: 'mindmap', pattern: /^mindmap\b/i },
  { kind: 'flowchart', pattern: /^(?:flowchart|graph)\b/i },
  { kind: 'sequence', pattern: /^sequenceDiagram\b/i },
  { kind: 'gantt', pattern: /^gantt\b/i },
  { kind: 'class', pattern: /^classDiagram\b/i },
  { kind: 'er', pattern: /^erDiagram\b/i },
  { kind: 'state', pattern: /^stateDiagram(?:-v2)?\b/i },
  { kind: 'pie', pattern: /^pie\b/i },
  { kind: 'timeline', pattern: /^timeline\b/i },
  { kind: 'git', pattern: /^gitGraph\b/i },
  { kind: 'journey', pattern: /^journey\b/i },
];

export interface FrameMermaidOptions {
  /** Previously drawn frames, keyed by source hash, reused instead of re-init. */
  restore?: Map<string, HTMLElement>;
}

export function mermaidKindLabel(kind: MermaidDiagramKind): string {
  return KIND_LABELS[kind];
}

/** First real mermaid statement, ignoring `%%` comments and `%%{init}%%`. */
export function detectMermaidKind(source: string): MermaidDiagramKind {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('%%')) continue;
    if (line === '---') continue;
    for (const matcher of KIND_MATCHERS) {
      if (matcher.pattern.test(line)) return matcher.kind;
    }
    break;
  }
  return 'unknown';
}

export function hashMermaidSource(source: string): string {
  const normalized = source.replace(/\r\n/g, '\n').trim();
  let hash = 0x811c9dc5;
  for (let i = 0; i < normalized.length; i++) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

function mermaidSourceFromHost(host: HTMLElement): string {
  const stored = host.getAttribute('data-source')
    ?? host.closest('.claudian-mermaid')?.getAttribute('data-source');
  if (stored) return stored;
  // `matches('code')` carries a type predicate whose false branch narrows an
  // HTMLElement to `never`, so compare the tag instead.
  const code = host.tagName === 'CODE' ? host : host.querySelector('code');
  if (code?.textContent) return code.textContent;
  if (!host.querySelector('svg')) return host.textContent ?? '';
  return '';
}

function collectMermaidHosts(root: HTMLElement): HTMLElement[] {
  const hosts: HTMLElement[] = [];
  const seen = new Set<HTMLElement>();
  const add = (el: HTMLElement | null) => {
    if (!el || seen.has(el)) return;
    if (el.closest('.claudian-mermaid')) return;
    seen.add(el);
    hosts.push(el);
  };

  for (const node of Array.from(root.querySelectorAll('.mermaid, .language-mermaid'))) {
    const el = node as HTMLElement;
    if (el.tagName === 'CODE') {
      add((el.closest('pre') as HTMLElement | null) ?? el);
    } else {
      add(el);
    }
  }
  return hosts;
}

/** Detach drawn mermaid cards so `el.empty()` cannot destroy a stable SVG. */
export function snapshotMermaidFrames(root: HTMLElement): Map<string, HTMLElement> {
  const frames = new Map<string, HTMLElement>();
  for (const node of Array.from(root.querySelectorAll('.claudian-mermaid'))) {
    const el = node as HTMLElement;
    const hash = el.getAttribute('data-source-hash');
    if (!hash || !el.querySelector('svg')) continue;
    frames.set(hash, el);
    el.remove();
  }
  return frames;
}

function createActionButton(
  parent: HTMLElement,
  icon: string,
  label: string,
  onClick: () => void,
): HTMLElement {
  const button = parent.createEl('button', {
    cls: 'claudian-mermaid-action',
    attr: { type: 'button', 'aria-label': label, title: label },
  });
  setIcon(button, icon);
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });
  return button;
}

function openMermaidFullscreen(svg: SVGSVGElement, title: string): void {
  const doc = svg.ownerDocument ?? window.document;
  const overlay = doc.body.createDiv({ cls: 'claudian-image-modal-overlay' });
  const modal = overlay.createDiv({ cls: 'claudian-image-modal claudian-mermaid-modal' });

  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.classList.add('claudian-mermaid-svg--fullscreen');
  modal.appendChild(clone);

  const caption = modal.createDiv({ cls: 'claudian-image-modal-caption' });
  caption.setText(title);

  const closeBtn = modal.createDiv({ cls: 'claudian-image-modal-close' });
  closeBtn.setText('×');

  const handleEsc = (event: KeyboardEvent) => {
    if (event.key === 'Escape') close();
  };
  const close = () => {
    doc.removeEventListener('keydown', handleEsc);
    overlay.remove();
  };
  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });
  doc.addEventListener('keydown', handleEsc);
}

function wrapMermaidHost(host: HTMLElement, restore?: Map<string, HTMLElement>): HTMLElement | null {
  const parent = host.parentElement;
  if (!parent) return null;

  const source = mermaidSourceFromHost(host);
  const hash = source ? hashMermaidSource(source) : '';
  const saved = hash ? restore?.get(hash) : undefined;
  if (saved?.querySelector('svg')) {
    parent.replaceChild(saved, host);
    restore?.delete(hash);
    return saved;
  }

  const kind = detectMermaidKind(source);
  const pending = !host.querySelector('svg');
  const doc = host.ownerDocument ?? window.document;
  const frame = doc.createElement('div');
  frame.className = pending ? 'claudian-mermaid is-pending' : 'claudian-mermaid';
  if (hash) frame.setAttribute('data-source-hash', hash);
  frame.setAttribute('data-kind', kind);
  if (source) frame.setAttribute('data-source', source);

  const header = frame.createDiv({ cls: 'claudian-mermaid-header' });
  const identity = header.createDiv({ cls: 'claudian-mermaid-identity' });
  const icon = identity.createSpan({ cls: 'claudian-mermaid-icon' });
  setIcon(icon, 'share-2');
  identity.createSpan({ cls: 'claudian-mermaid-label', text: mermaidKindLabel(kind) });
  if (pending) {
    identity.createSpan({ cls: 'claudian-mermaid-live', text: 'LIVE' });
  }

  const canvas = frame.createDiv({ cls: 'claudian-mermaid-canvas' });
  parent.insertBefore(frame, host);
  canvas.appendChild(host);

  const svg = () => frame.querySelector('svg');
  const actions = header.createDiv({ cls: 'claudian-mermaid-actions' });
  if (source) {
    createActionButton(actions, 'copy', 'Quelle kopieren', () => {
      void navigator.clipboard?.writeText(source)
        .then(() => new Notice('Mermaid-Quelle kopiert.'))
        .catch(() => new Notice('Kopieren fehlgeschlagen.'));
    });
  }
  if (!pending) {
    createActionButton(actions, 'maximize-2', 'Vollbild', () => {
      const drawn = svg();
      if (!drawn) return;
      openMermaidFullscreen(drawn, mermaidKindLabel(kind));
    });
  }

  const footer = frame.createDiv({ cls: 'claudian-mermaid-footer' });
  footer.createSpan({
    text: pending
      ? 'Diagramm wird gezeichnet…'
      : 'Obsidian-Mermaid · Quelle kopieren oder Vollbild',
  });
  return frame;
}

/** Wrap every mermaid host in `root` with the glass diagram card. */
export function frameMermaidDiagrams(
  root: HTMLElement,
  options?: FrameMermaidOptions,
): number {
  let framed = 0;
  for (const host of collectMermaidHosts(root)) {
    if (wrapMermaidHost(host, options?.restore)) framed += 1;
  }
  return framed;
}
