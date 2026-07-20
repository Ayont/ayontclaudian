import { setIcon } from 'obsidian';

import { findTextMatches, wrapIndex } from './chatSearchMatching';

const SEARCH_DEBOUNCE_MS = 120;
const HIGHLIGHT_NAME = 'claudian-search';
const ACTIVE_HIGHLIGHT_NAME = 'claudian-search-active';

/** Minimal structural types for the CSS Custom Highlight API (Chromium 105+). */
interface HighlightRegistryLike {
  set(name: string, highlight: unknown): void;
  delete(name: string): boolean;
}
type HighlightConstructor = new (...ranges: AbstractRange[]) => unknown;

function getHighlightApi(): { registry: HighlightRegistryLike; Highlight: HighlightConstructor } | null {
  const globals = window as {
    Highlight?: HighlightConstructor;
    CSS?: { highlights?: HighlightRegistryLike };
  };
  const registry = globals.CSS?.highlights;
  const ctor = globals.Highlight;
  return registry && ctor ? { registry, Highlight: ctor } : null;
}

/**
 * In-chat search (Cmd/Ctrl+F): a floating bar over the transcript with live
 * term highlighting, a match counter, and circular prev/next navigation.
 *
 * Term highlighting uses the CSS Custom Highlight API — no DOM mutation of the
 * rendered markdown, so code blocks, links, and copy buttons stay untouched.
 * On engines without the API the bar still navigates matches and flashes the
 * containing message instead.
 */
export class ChatSearchController {
  private readonly containerEl: HTMLElement;
  private readonly inputEl: HTMLInputElement;
  private readonly countEl: HTMLElement;

  private matchRanges: Range[] = [];
  private activeIndex = 0;
  private isOpen = false;
  private isDirty = false;
  private debounceTimer: number | null = null;
  private observer: MutationObserver | null = null;
  private lastFlashedEl: HTMLElement | null = null;

  constructor(
    hostEl: HTMLElement,
    private readonly messagesEl: HTMLElement,
  ) {
    this.containerEl = hostEl.createDiv({ cls: 'claudian-chat-search claudian-hidden' });

    const iconEl = this.containerEl.createSpan({ cls: 'claudian-chat-search-icon' });
    setIcon(iconEl, 'search');

    this.inputEl = this.containerEl.createEl('input', {
      cls: 'claudian-chat-search-input',
      attr: {
        type: 'text',
        placeholder: 'Im Chat suchen…',
        'aria-label': 'Im Chat suchen',
        spellcheck: 'false',
      },
    });

    this.countEl = this.containerEl.createSpan({ cls: 'claudian-chat-search-count' });

    this.createButton('chevron-up', 'Vorheriger Treffer', () => this.navigate(-1));
    this.createButton('chevron-down', 'Nächster Treffer', () => this.navigate(1));
    this.createButton('x', 'Suche schließen', () => this.close());

    this.inputEl.addEventListener('input', () => this.scheduleSearch());
    this.inputEl.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.navigate(event.shiftKey ? -1 : 1);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        this.close();
      }
    });
  }

  // ============================================
  // Public API
  // ============================================

  open(): void {
    if (!this.isOpen) {
      this.isOpen = true;
      this.containerEl.removeClass('claudian-hidden');
      this.startObserver();
      if (this.inputEl.value) this.runSearch();
    }
    this.inputEl.focus?.();
    this.inputEl.select?.();
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.containerEl.addClass('claudian-hidden');
    this.stopObserver();
    this.clearHighlights();
    this.matchRanges = [];
    this.updateCount();
  }

  toggle(): void {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  isVisible(): boolean {
    return this.isOpen;
  }

  destroy(): void {
    this.close();
    if (this.debounceTimer !== null) {
      window.clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.containerEl.remove();
  }

  // ============================================
  // Search
  // ============================================

  private scheduleSearch(): void {
    if (this.debounceTimer !== null) window.clearTimeout(this.debounceTimer);
    this.debounceTimer = window.setTimeout(() => {
      this.debounceTimer = null;
      this.runSearch();
    }, SEARCH_DEBOUNCE_MS);
  }

  private runSearch(): void {
    this.isDirty = false;
    this.clearHighlights();
    this.matchRanges = [];
    this.activeIndex = 0;

    const query = this.inputEl.value.trim();
    if (query) {
      const textNodes = this.collectTextNodes();
      const matches = findTextMatches(textNodes.map((node) => node.data), query);
      const doc = this.messagesEl.ownerDocument;
      for (const match of matches) {
        try {
          const range = doc.createRange();
          range.setStart(textNodes[match.nodeIndex], match.start);
          range.setEnd(textNodes[match.nodeIndex], match.end);
          this.matchRanges.push(range);
        } catch {
          // Node mutated mid-search — skip this match.
        }
      }
    }

    this.applyHighlights();
    this.updateCount();
    if (this.matchRanges.length > 0) {
      this.scrollToActive();
    }
  }

  /** Text nodes of the transcript in document order (welcome screen excluded). */
  private collectTextNodes(): Text[] {
    const doc = this.messagesEl.ownerDocument;
    if (typeof doc?.createTreeWalker !== 'function') return [];

    const nodes: Text[] = [];
    const walker = doc.createTreeWalker(this.messagesEl, NodeFilter.SHOW_TEXT);
    let current = walker.nextNode();
    while (current) {
      const text = current as Text;
      if (text.data.trim() && !(text.parentElement?.closest('.claudian-welcome'))) {
        nodes.push(text);
      }
      current = walker.nextNode();
    }
    return nodes;
  }

  // ============================================
  // Navigation & highlighting
  // ============================================

  private navigate(delta: number): void {
    // New messages streamed in while the bar was open — refresh so navigation
    // covers them and stale ranges never scroll to detached nodes.
    if (this.isDirty) {
      this.runSearch();
      if (delta < 0) {
        this.activeIndex = wrapIndex(this.matchRanges.length - 1, this.matchRanges.length);
        this.applyActiveHighlight();
        this.updateCount();
        this.scrollToActive();
      }
      return;
    }
    if (this.matchRanges.length === 0) return;
    this.activeIndex = wrapIndex(this.activeIndex + delta, this.matchRanges.length);
    this.applyActiveHighlight();
    this.updateCount();
    this.scrollToActive();
  }

  private applyHighlights(): void {
    const api = getHighlightApi();
    if (!api || this.matchRanges.length === 0) return;
    api.registry.set(HIGHLIGHT_NAME, new api.Highlight(...this.matchRanges));
    this.applyActiveHighlight();
  }

  private applyActiveHighlight(): void {
    const api = getHighlightApi();
    const active = this.matchRanges[this.activeIndex];
    if (!api || !active) return;
    api.registry.set(ACTIVE_HIGHLIGHT_NAME, new api.Highlight(active));
  }

  private clearHighlights(): void {
    const api = getHighlightApi();
    if (api) {
      api.registry.delete(HIGHLIGHT_NAME);
      api.registry.delete(ACTIVE_HIGHLIGHT_NAME);
    }
    this.lastFlashedEl?.removeClass('claudian-search-flash');
    this.lastFlashedEl = null;
  }

  private scrollToActive(): void {
    const range = this.matchRanges[this.activeIndex];
    const el = range?.startContainer.parentElement;
    if (!el) return;
    el.scrollIntoView?.({ block: 'center' });

    // Fallback flash for engines without the Custom Highlight API — the user
    // still sees which message the active match lives in.
    if (!getHighlightApi()) {
      this.lastFlashedEl?.removeClass('claudian-search-flash');
      const flashTarget = (el.closest('.claudian-message') as HTMLElement | null) ?? el;
      flashTarget.addClass('claudian-search-flash');
      this.lastFlashedEl = flashTarget;
    }
  }

  private updateCount(): void {
    if (this.matchRanges.length === 0) {
      this.countEl.setText(this.inputEl.value.trim() ? '0' : '');
      this.containerEl.removeClass('has-matches');
      return;
    }
    this.countEl.setText(`${this.activeIndex + 1}/${this.matchRanges.length}`);
    this.containerEl.addClass('has-matches');
  }

  // ============================================
  // Helpers
  // ============================================

  private createButton(icon: string, label: string, onClick: () => void): HTMLElement {
    const btn = this.containerEl.createEl('button', {
      cls: 'claudian-chat-search-btn',
      attr: { 'aria-label': label, type: 'button' },
    });
    setIcon(btn, icon);
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      onClick();
    });
    return btn;
  }

  private startObserver(): void {
    if (this.observer || typeof MutationObserver !== 'function') return;
    this.observer = new MutationObserver(() => {
      this.isDirty = true;
    });
    this.observer.observe(this.messagesEl, { childList: true, subtree: true, characterData: true });
  }

  private stopObserver(): void {
    this.observer?.disconnect();
    this.observer = null;
  }
}
