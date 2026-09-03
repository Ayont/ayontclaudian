import { setIcon } from 'obsidian';

import { ProviderRegistry } from '../../../core/providers/ProviderRegistry';
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
export class TabBar {
  private containerEl: HTMLElement;
  private callbacks: TabBarCallbacks;

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
    // Clear existing badges
    this.containerEl.empty();

    // Render badges
    for (const item of items) {
      this.renderBadge(item);
    }
  }

  /** Renders a single tab badge. */
  private renderBadge(item: TabBarItem): void {
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
      cls: `claudian-tab-badge ${stateClass}`,
      text: String(item.index),
      attr: { type: 'button' },
    });

    // Tooltip with full title (aria-label only; adding title too causes double tooltip)
    badgeEl.setAttribute('aria-label', item.title);
    badgeEl.setAttribute('data-provider', item.providerId);
    if (item.isActive) {
      badgeEl.setAttribute('aria-current', 'page');
    }

    // Provider icon badge in the corner:
    // Enables instant recognition of which AI provider is powering this chat (Claude, Codex, Antigravity, Grok, etc.)
    const reg = ProviderRegistry.getProviderRegistrationSafe(item.providerId);
    if (reg?.chatUIConfig?.icon) {
      const providerBadge = badgeEl.createSpan({ cls: 'claudian-tab-provider-badge' });
      providerBadge.setAttribute('aria-hidden', 'true');
      const iconSvg = createProviderIconSvg(reg.chatUIConfig.icon, {
        width: 10,
        height: 10,
        className: 'claudian-tab-provider-icon',
        dataProvider: item.providerId,
        ownerDocument: this.containerEl.ownerDocument,
      });
      providerBadge.appendChild(iconSvg);
    }

    // Recognized topic / conversation title label:
    // Displays the conversation name (e.g. "Fortinet Firewall", "HUNARI DEV") so the boss/user instantly recognizes it.
    const cleanTitle = (item.title && item.title !== 'Neuer Chat' && item.title !== 'New chat')
      ? item.title.trim()
      : '';
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

    // Close button (if allowed)
    if (item.canClose) {
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
        attr: { 'aria-label': `${item.title} schließen` },
      });
      setIcon(closeBtn, 'x');
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.callbacks.onTabClose(item.id);
      });
    }
  }

  /** Destroys the tab bar. */
  destroy(): void {
    this.containerEl.empty();
    this.containerEl.removeClass('claudian-tab-badges');
  }
}
