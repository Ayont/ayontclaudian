/** @jest-environment jsdom */

import {
  detectMermaidKind,
  frameMermaidDiagrams,
  hashMermaidSource,
  mermaidKindLabel,
  snapshotMermaidFrames,
} from '@/features/chat/rendering/MermaidFrame';

function installObsidianDomHelpers(): void {
  (HTMLElement.prototype as any).createDiv = function createDiv(options?: { cls?: string; text?: string }) {
    const element = document.createElement('div');
    if (options?.cls) element.className = options.cls;
    if (options?.text) element.textContent = options.text;
    this.appendChild(element);
    return element;
  };
  (HTMLElement.prototype as any).createSpan = function createSpan(options?: { cls?: string; text?: string }) {
    const element = document.createElement('span');
    if (options?.cls) element.className = options.cls;
    if (options?.text) element.textContent = options.text;
    this.appendChild(element);
    return element;
  };
  (HTMLElement.prototype as any).createEl = function createEl(
    tag: string,
    options?: { cls?: string; text?: string; attr?: Record<string, string> },
  ) {
    const element = document.createElement(tag);
    if (options?.cls) element.className = options.cls;
    if (options?.text) element.textContent = options.text;
    for (const [name, value] of Object.entries(options?.attr ?? {})) {
      element.setAttribute(name, value);
    }
    this.appendChild(element);
    return element;
  };
  (HTMLElement.prototype as any).setText = function setText(text: string) {
    this.textContent = text;
  };
}

describe('MermaidFrame', () => {
  beforeAll(() => installObsidianDomHelpers());

  describe('detectMermaidKind', () => {
    it('reads the first real statement after comments and init directives', () => {
      expect(detectMermaidKind('%% comment\n%%{init: {"theme":"dark"}}%%\nmindmap\n  root((x))')).toBe('mindmap');
      expect(detectMermaidKind('flowchart TD\nA-->B')).toBe('flowchart');
      expect(detectMermaidKind('graph LR\nA-->B')).toBe('flowchart');
      expect(detectMermaidKind('sequenceDiagram\nA->>B: hi')).toBe('sequence');
      expect(detectMermaidKind('gantt\ndateFormat YYYY')).toBe('gantt');
      expect(detectMermaidKind('pie title Split\n"A": 1')).toBe('pie');
      expect(detectMermaidKind('not a diagram')).toBe('unknown');
    });
  });

  describe('mermaidKindLabel', () => {
    it('uses German labels for chat chrome', () => {
      expect(mermaidKindLabel('mindmap')).toBe('Mindmap');
      expect(mermaidKindLabel('flowchart')).toBe('Prozess');
      expect(mermaidKindLabel('unknown')).toBe('Diagramm');
    });
  });

  describe('hashMermaidSource', () => {
    it('is stable for the same source and changes when the diagram changes', () => {
      const a = hashMermaidSource('flowchart TD\nA-->B');
      const b = hashMermaidSource('flowchart TD\nA-->B\n');
      const c = hashMermaidSource('flowchart TD\nA-->C');
      expect(a).toBe(b);
      expect(a).not.toBe(c);
    });
  });

  describe('frameMermaidDiagrams', () => {
    it('wraps a pending language-mermaid fence as a live source card', () => {
      const root = document.createElement('div');
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.className = 'language-mermaid';
      code.textContent = 'mindmap\n  root((Thema))';
      pre.appendChild(code);
      root.appendChild(pre);

      expect(frameMermaidDiagrams(root)).toBe(1);
      const frame = root.querySelector('.claudian-mermaid');
      expect(frame).not.toBeNull();
      expect(frame?.classList.contains('is-pending')).toBe(true);
      expect(frame?.querySelector('.claudian-mermaid-label')?.textContent).toBe('Mindmap');
      expect(frame?.querySelector('.claudian-mermaid-live')?.textContent).toBe('LIVE');
      expect(frame?.contains(pre)).toBe(true);
    });

    it('wraps a drawn mermaid svg without the pending state', () => {
      const root = document.createElement('div');
      const mermaid = document.createElement('div');
      mermaid.className = 'mermaid';
      mermaid.setAttribute('data-source', 'flowchart TD\nA-->B');
      mermaid.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'svg'));
      root.appendChild(mermaid);

      expect(frameMermaidDiagrams(root)).toBe(1);
      const frame = root.querySelector('.claudian-mermaid');
      expect(frame?.classList.contains('is-pending')).toBe(false);
      expect(frame?.querySelector('.claudian-mermaid-label')?.textContent).toBe('Prozess');
      expect(frame?.querySelector('svg')).not.toBeNull();
    });

    it('does not wrap an already framed diagram', () => {
      const root = document.createElement('div');
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.className = 'language-mermaid';
      code.textContent = 'pie title X\n"A": 1';
      pre.appendChild(code);
      root.appendChild(pre);

      expect(frameMermaidDiagrams(root)).toBe(1);
      expect(frameMermaidDiagrams(root)).toBe(0);
      expect(root.querySelectorAll('.claudian-mermaid')).toHaveLength(1);
    });

    it('restores a previously drawn svg when the source hash matches', () => {
      const root = document.createElement('div');
      const mermaid = document.createElement('div');
      mermaid.className = 'mermaid';
      mermaid.setAttribute('data-source', 'flowchart TD\nA-->B');
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('data-stable', 'yes');
      mermaid.appendChild(svg);
      root.appendChild(mermaid);
      frameMermaidDiagrams(root);

      const restore = snapshotMermaidFrames(root);
      expect(root.querySelector('.claudian-mermaid')).toBeNull();

      const pending = document.createElement('pre');
      const code = document.createElement('code');
      code.className = 'language-mermaid';
      code.textContent = 'flowchart TD\nA-->B';
      pending.appendChild(code);
      root.appendChild(pending);

      frameMermaidDiagrams(root, { restore });
      expect(root.querySelector('svg[data-stable="yes"]')).not.toBeNull();
      expect(root.querySelector('.claudian-mermaid.is-pending')).toBeNull();
    });
  });
});
