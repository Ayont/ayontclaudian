import { setIcon } from 'obsidian';

import { ProviderRegistry } from '../../../core/providers/ProviderRegistry';
import { setDraftIcon } from '../../../shared/draftIcon';
import { createProviderIconSvg } from '../../../shared/icons';
import { measureTabStripOverflow, scrollLeftToReveal, type TabBadgeGeometry } from './tabBarOverflow';
import { describeTabBadgeStatus, displayTabTitle, isGenericTabTitle } from './tabOverviewModel';
import type { TabBarItem, TabId } from './types';

/** Callbacks for TabBar interactions. */
export interface TabBarCallbacks {
  /** Called when a tab badge is clicked. */
  onTabClick: (tabId: TabId) => void;

  /** Called when the close button is clicked on a tab. */
  onTabClose: (tabId: TabId) => void;

  /** Called when the new tab button is clicked. */
  onNewTab: () => void;

  /** The "+N" chip for tabs scrolled out of view. */
  onOpenOverview?: () => void;

  /** Right-click on a tab. Without it, right-click closes the tab. */
  onTabContextMenu?: (tabId: TabId, event: MouseEvent) => void;
}

export interface TabBarOptions {
  /** Where the "+N" chip lives: beside the strip, because the strip scrolls. */
  overflowHostEl?: HTMLElement;
}

/** Keeps a revealed badge clear of the edge fade. */
const REVEAL_MARGIN = 16;

function badgeSignature(item: TabBarItem): string {
  return [
    item.index, item.title, item.providerId, item.isActive, item.isStreaming,
    item.needsAttention, item.attentionReason ?? '', item.canClose, item.hasDraft,
  ].join('\u0001');
}

function attentionOf(item: TabBarItem): TabBarItem['attentionReason'] {
  if (!item.needsAttention) return null;
  return item.attentionReason ?? 'input';
}

/**
 * TabBar renders minimal numbered badge navigation.
 */
export class TabBar {
  private containerEl: HTMLElement;
  private callbacks: TabBarCallbacks;
  /** Badges by tab, with the state they were drawn for. */
  private rendered = new Map<TabId, { el: HTMLElement; signature: string }>();
  private items: TabBarItem[] = [];
  private overflowChipEl: HTMLButtonElement | null = null;
  private revealedActiveId: TabId | null = null;
  private pendingOverflowFrame: number | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private readonly onScroll = (): void => this.scheduleOverflowRefresh();

  constructor(containerEl: HTMLElement, callbacks: TabBarCallbacks, options: TabBarOptions = {}) {
    this.containerEl = containerEl;
    this.callbacks = callbacks;
    this.build(options);
  }

  /** Builds the tab bar UI. */
  private build(options: TabBarOptions): void {
    this.containerEl.addClass('claudian-tab-badges');
    this.containerEl.setAttribute('aria-label', 'Chat-Tabs');
    if (!options.overflowHostEl) return;

    this.overflowChipEl = options.overflowHostEl.createEl('button', {
      cls: 'claudian-tab-overflow-chip claudian-hidden',
      attr: { type: 'button' },
    });
    this.overflowChipEl.addEventListener('click', (event) => {
      event.stopPropagation();
      this.callbacks.onOpenOverview?.();
    });
    this.containerEl.addEventListener('scroll', this.onScroll, { passive: true });
    const ResizeObserverCtor = this.containerEl.ownerDocument?.defaultView?.ResizeObserver;
    if (ResizeObserverCtor) {
      this.resizeObserver = new ResizeObserverCtor(() => this.scheduleOverflowRefresh());
      this.resizeObserver.observe(this.containerEl);
    }
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
    this.items = items;
    this.scheduleOverflowRefresh();
  }

  /**
   * Re-measures the strip: edge fades, the "+N" chip, and scrolling a newly
   * active tab into view. Reads offsets of at most ten badges.
   */
  refreshOverflow(): void {
    if (!this.overflowChipEl) return;
    const badges = this.readBadgeGeometry();
    const active = this.items.find((item) => item.isActive) ?? null;
    if (active && active.id !== this.revealedActiveId) {
      this.revealedActiveId = active.id;
      const geometry = badges.find((badge) => badge.id === active.id);
      const target = geometry ? scrollLeftToReveal(this.readStripGeometry(), geometry, REVEAL_MARGIN) : null;
      if (target !== null) this.containerEl.scrollLeft = target;
    }

    const overflow = measureTabStripOverflow(this.readStripGeometry(), badges);
    this.containerEl.toggleClass('has-overflow-start', overflow.canScrollStart);
    this.containerEl.toggleClass('has-overflow-end', overflow.canScrollEnd);
    this.renderOverflowChip(overflow.hiddenIds);
  }

  private scheduleOverflowRefresh(): void {
    if (!this.overflowChipEl || this.pendingOverflowFrame !== null) return;
    const view = this.containerEl.ownerDocument?.defaultView;
    if (!view?.requestAnimationFrame) {
      this.refreshOverflow();
      return;
    }
    this.pendingOverflowFrame = view.requestAnimationFrame(() => {
      this.pendingOverflowFrame = null;
      this.refreshOverflow();
    });
  }

  private readStripGeometry(): { scrollLeft: number; clientWidth: number; scrollWidth: number } {
    return {
      scrollLeft: this.containerEl.scrollLeft ?? 0,
      clientWidth: this.containerEl.clientWidth ?? 0,
      scrollWidth: this.containerEl.scrollWidth ?? 0,
    };
  }

  private readBadgeGeometry(): TabBadgeGeometry[] {
    const badges: TabBadgeGeometry[] = [];
    for (const [id, { el }] of this.rendered) {
      badges.push({ id, left: el.offsetLeft ?? 0, width: el.offsetWidth ?? 0 });
    }
    return badges;
  }

  private renderOverflowChip(hiddenIds: TabId[]): void {
    const chip = this.overflowChipEl;
    if (!chip) return;
    const hidden = new Set(hiddenIds);
    const waiting = this.items.filter((item) => hidden.has(item.id) && attentionOf(item) !== null).length;
    chip.toggleClass('claudian-hidden', hidden.size === 0);
    chip.toggleClass('has-attention', waiting > 0);
    if (hidden.size === 0) return;

    const text = `+${hidden.size}`;
    if (chip.textContent !== text) chip.setText(text);
    const tabs = hidden.size === 1 ? '1 weiterer Tab' : `${hidden.size} weitere Tabs`;
    const waitingText = waiting === 0 ? '' : `, ${waiting} ${waiting === 1 ? 'wartet' : 'warten'} auf dich`;
    chip.setAttribute('aria-label', `${tabs}${waitingText} – Übersicht öffnen`);
  }

  /** Renders a single tab badge. */
  private renderBadge(item: TabBarItem): HTMLElement {
    const attention = attentionOf(item);
    // Determine state class (priority: active > attention > streaming > idle)
    let stateClass = 'claudian-tab-badge-idle';
    if (item.isActive) {
      stateClass = 'claudian-tab-badge-active';
    } else if (attention) {
      stateClass = 'claudian-tab-badge-attention';
    } else if (item.isStreaming) {
      stateClass = 'claudian-tab-badge-streaming';
    }

    const badgeEl = this.containerEl.createEl('button', {
      cls: `claudian-tab-badge clickable-icon ${stateClass}${item.isActive ? " claudian-tab-badge--active" : ""}`,
      text: String(item.index),
      attr: { type: 'button' },
    });

    const reg = ProviderRegistry.getProviderRegistrationSafe(item.providerId);
    // Tooltip via aria-label only; adding title too causes a double tooltip.
    const status = describeTabBadgeStatus({ isStreaming: item.isStreaming, attention, hasDraft: item.hasDraft });
    const tooltip = [displayTabTitle(item.title), reg?.displayName, status].filter(Boolean).join(' · ');
    badgeEl.setAttribute('aria-label', tooltip);
    if (item.hasDraft) {
      badgeEl.addClass('claudian-tab-badge--draft');
    }
    badgeEl.setAttribute('data-provider', item.providerId);
    if (attention) badgeEl.setAttribute('data-attention', attention);
    if (item.isActive) {
      badgeEl.setAttribute('aria-current', 'page');
    }

    // Provider icon: clearly identifies which provider runs this tab inline, never cut off
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

    // One corner mark: why the tab wants the user back, else whether it works.
    if (attention) {
      const dotEl = badgeEl.createSpan({ cls: 'claudian-tab-attention-dot' });
      dotEl.setAttribute('aria-hidden', 'true');
      dotEl.setAttribute('data-reason', attention);
    } else if (item.isStreaming) {
      badgeEl.createSpan({ cls: 'claudian-tab-streaming-indicator', attr: { 'aria-hidden': 'true' } });
    }

    // Blank chats stay compact: no "New Chat" label next to the number.
    const cleanTitle = isGenericTabTitle(item.title) ? '' : item.title.trim();
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
        if (this.callbacks.onTabContextMenu) {
          this.callbacks.onTabContextMenu(item.id, e);
          return;
        }
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
          'aria-label': `${displayTabTitle(item.title)} schließen`,
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
    if (this.pendingOverflowFrame !== null) {
      this.containerEl.ownerDocument?.defaultView?.cancelAnimationFrame(this.pendingOverflowFrame);
      this.pendingOverflowFrame = null;
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.containerEl.removeEventListener('scroll', this.onScroll);
    this.overflowChipEl?.remove();
    this.overflowChipEl = null;
    this.rendered.clear();
    this.containerEl.empty();
    this.containerEl.removeClass('claudian-tab-badges');
  }
}
