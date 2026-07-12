import { setIcon } from 'obsidian';

import { parseAutoMemoryBlocks } from '../../../core/memory/autoMemory';

/**
 * Replaces rendered ```claudian-memory code fences with a compact memory chip.
 * Purely presentational — persistence happens once at stream end in the
 * InputController; this runs for live streaming AND reloaded history alike.
 */
export function renderAutoMemoryChips(root: HTMLElement): void {
  const codeEls = Array.from(root.querySelectorAll('pre code.language-claudian-memory'));
  if (codeEls.length === 0) return;

  for (const codeEl of codeEls) {
    const pre = codeEl.closest('pre');
    if (!pre?.parentElement) continue;

    const body = codeEl.textContent ?? '';
    // The code element's text is the fence body — wrap it so the shared
    // parser (which expects full fences) can read topic/tags/state.
    const [block] = parseAutoMemoryBlocks(`\`\`\`claudian-memory\n${body}\n\`\`\``);
    const topic = block?.topic || 'Memory';

    const doc = root.ownerDocument ?? window.document;
    const chip = doc.createElement('div');
    chip.className = 'claudian-auto-memory-chip';
    chip.setAttribute('title', block?.content ?? '');

    const iconEl = doc.createElement('span');
    iconEl.className = 'claudian-auto-memory-chip-icon';
    setIcon(iconEl, 'brain-circuit');
    chip.appendChild(iconEl);

    const labelEl = doc.createElement('span');
    labelEl.className = 'claudian-auto-memory-chip-label';
    labelEl.textContent = `Memory gespeichert · ${topic}`;
    chip.appendChild(labelEl);

    pre.parentElement.replaceChild(chip, pre);
  }
}
