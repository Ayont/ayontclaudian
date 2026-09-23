import { setIcon } from 'obsidian';

import { ProviderRegistry } from '../../../core/providers/ProviderRegistry';
import { setDraftIcon } from '../../../shared/draftIcon';
import { createProviderIconSvg } from '../../../shared/icons';
import type { TabBarItem, TabId } from './types';

/** Callbacks for TabBar interactions. */
export interface TabBarCallbacks {
  /** Called when a tab badge is clicked. */
  onTabClick: (tabId: TabId) => void;

  /** Called when the close button is clicked on a tab. */
  onTabClose: (tabId: TabId) => void;

  /** Called when the new tab button is clicked. */
  onNewTab: () => void;
}

/**
 * TabBar renders minimal numbered badge navigation.
 */
function badgeSignature(item: TabBarItem): string {
  return [
    item.index, item.title, item.providerId, item.isActive, item.isStreaming,
    item.needsAttention, item.canClose, item.hasDraft,
  ].join('\u0001');
}

export class TabBar {
  private containerEl: HTMLElement;
  private callbacks: TabBarCallbacks;
  /** Badges by tab, with the state they were drawn for. */
  private rendered = new Map<TabId, { el: HTMLElement; signature: string }>();

  constructor(containerEl: HTMLElement, callbacks: TabBarCallbacks) {
    this.containerEl = containerEl;
    this.callbacks = callbacks;
    this.build();
  }

  /** Builds the tab bar UI. */
  private build(): void {
    this.containerEl.addClass('claudian-tab-badges');
    this.containerEl.setAttribute('aria-label', 'Chat-Tabs');
  }

  /**
   * Updates the tab bar with new tab data.
   * @param items Tab items to render.
   */
  update(items: TabBarItem[]): void {
    // Streaming, title, draft and attention changes all land here; redrawing
    // every badge (icons, listeners) for each of them added up with many tabs.
    // Only badges whose visible state changed are rebuilt.
    const next = new Map<TabId, { el: HTMLElement; signature: string }>();
    items.forEach((item, position) => {
      const signature = badgeSignature(item);
      const existing = this.rendered.get(item.id);
      let el: HTMLElement;
      if (existing && existing.signature === signature) {
        el = existing.el;
      } else {
        existing?.el.remove();
        el = this.renderBadge(item);
      }
      next.set(item.id, { el, signature });
      const atPosition = this.containerEl.children[position] ?? null;
      if (atPosition !== el) this.containerEl.insertBefore(el, atPosition);
    });
    for (const [id, entry] of this.rendered) {
      if (!next.has(id)) entry.el.remove();
    }
    this.rendered = next;
  }

  /** Renders a single tab badge. */
  private renderBadge(item: TabBarItem): HTMLElement {
    // Determine state class (priority: active > attention > streaming > idle)
    let stateClass = 'claudian-tab-badge-idle';
    if (item.isActive) {
      stateClass = 'claudian-tab-badge-active';
    } else if (item.needsAttention) {
      stateClass = 'claudian-tab-badge-attention';
    } else if (item.isStreaming) {
      stateClass = 'claudian-tab-badge-streaming';
    }

    const badgeEl = this.containerEl.createEl('button', {
      cls: `claudian-tab-badge clickable-icon ${stateClass}${item.isActive ? " claudian-tab-badge--active" : ""}`,
      text: String(item.index),
      attr: { type: 'button' },
    });

    // Tooltip with full title (aria-label only; adding title too causes double tooltip)
    const streamingSuffix = item.isStreaming ? ' (arbeitet…)' : '';
    const draftSuffix = item.hasDraft ? ' (Entwurf)' : '';
    badgeEl.setAttribute('aria-label', `${item.title}${streamingSuffix}${draftSuffix}`);
    if (item.hasDraft) {
      badgeEl.addClass('claudian-tab-badge--draft');
    }
    badgeEl.setAttribute('data-provider', item.providerId);
    if (item.isActive) {
      badgeEl.setAttribute('aria-current', 'page');
    }

    // Provider icon: clearly identifies which provider runs this tab inline, never cut off
    const reg = ProviderRegistry.getProviderRegistrationSafe(item.providerId);
    const providerIcon = reg?.chatUIConfig?.getProviderIcon?.();
    if (providerIcon) {
      const providerBadge = badgeEl.createSpan({ cls: 'claudian-tab-provider-badge' });
      providerBadge.setAttribute('aria-hidden', 'true');
      const iconSvg = createProviderIconSvg(providerIcon, {
        width: 11,
        height: 11,
        className: 'claudian-tab-provider-icon',
        dataProvider: item.providerId,
        ownerDocument: this.containerEl.ownerDocument,
      });
      providerBadge.appendChild(iconSvg);
    }

    // Unsent draft in this chat, as the pencil in T3 Code's thread list.
    if (item.hasDraft) {
      const draftEl = badgeEl.createSpan({ cls: 'claudian-tab-draft-indicator', attr: { 'aria-hidden': 'true' } });
      setDraftIcon(draftEl);
    }

    // Visible pulsing live beacon when agent is actively generating/working in this tab
    if (item.isStreaming) {
      badgeEl.createSpan({ cls: 'claudian-tab-streaming-indicator', attr: { 'aria-hidden': 'true' } });
    }

    // Recognized topic / conversation title label:
    // Filter out all variants of generic "New Chat" / "Neuer Chat" so blank chats stay compact.
    const isGenericTitle = !item.title || /^(new(\s*chat)?|neuer(\s*chat)?|chat\s*\d+)$/i.test(item.title.trim());
    const cleanTitle = !isGenericTitle ? item.title.trim() : '';
    if (cleanTitle) {
      badgeEl.setAttribute('data-tab-title', cleanTitle);
      badgeEl.createSpan({
        cls: 'claudian-tab-badge-title',
        text: cleanTitle,
      });
    }

    // Click handler to switch tab
    badgeEl.addEventListener('click', () => {
      this.callbacks.onTabClick(item.id);
    });

    // Close button & middle-click close (if allowed)
    if (item.canClose) {
      badgeEl.addEventListener('auxclick', (e) => {
        if (e.button === 1) {
          e.preventDefault();
          e.stopPropagation();
          this.callbacks.onTabClose(item.id);
        }
      });
      badgeEl.setAttribute('aria-keyshortcuts', 'Delete');
      badgeEl.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.callbacks.onTabClose(item.id);
      });
      badgeEl.addEventListener('keydown', (event) => {
        if (event.key !== 'Delete' && event.key !== 'Backspace') return;
        event.preventDefault();
        this.callbacks.onTabClose(item.id);
      });

      const closeBtn = badgeEl.createSpan({
        cls: 'claudian-tab-badge-close',
        attr: {
          'aria-label': `${item.title} schließen`,
          role: 'button',
          tabindex: '0',
        },
      });
      setIcon(closeBtn, 'x');
      closeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.callbacks.onTabClose(item.id);
      });
    }
    return badgeEl;
  }

  /** Destroys the tab bar. */
  destroy(): void {
    this.rendered.clear();
    this.containerEl.empty();
    this.containerEl.removeClass('claudian-tab-badges');
  }
}
