import { Platform, setIcon } from 'obsidian';

import { ProviderRegistry } from '../../../core/providers/ProviderRegistry';
import { setDraftIcon } from '../../../shared/draftIcon';
import { createProviderIconSvg } from '../../../shared/icons';
import { GO_TO_TAB_COMMAND_COUNT } from './tabCommands';
import {
  composeModelLine,
  describeTabStatus,
  filterTabOverviewItems,
  summarizeTabOverview,
  type TabClock,
  type TabOverviewItem,
  tabOverviewRowSignature,
  type TabStatusKind,
} from './tabOverviewModel';
import type { TabId } from './types';

export interface TabOverviewCallbacks {
  /** Cheap, in-memory rows; called on open, on tab events and once a second while open. */
  getItems: () => TabOverviewItem[];
  onSelect: (tabId: TabId) => void;
  /** Closes the tab; the overview has already asked when it was still working. */
  onClose: (tabId: TabId) => void;
  onNewTab: () => void;
  canCreateTab: () => boolean;
  /** Lets the view close sibling popovers such as the history. */
  onOpen?: () => void;
}

export interface TabOverviewOptions {
  clock?: () => TabClock;
}

/** The streaming clock shows seconds; ages ("vor 3 Min.") ride along. */
const TICK_MS = 1000;
/** Context usage from here on reads as a warning rather than a fact. */
const HIGH_CONTEXT_PERCENT = 80;

let overviewSequence = 0;

interface OverviewRow {
  el: HTMLElement;
  avatarEl: HTMLElement;
  mainEl: HTMLButtonElement;
  titleEl: HTMLElement;
  modelEl: HTMLElement;
  statusMarkEl: HTMLElement;
  statusTextEl: HTMLElement;
  metaEl: HTMLElement;
  keyEl: HTMLElement;
  closeEl: HTMLButtonElement;
  confirmEl: HTMLElement;
  confirmStopEl: HTMLButtonElement;
  item: TabOverviewItem;
  signature: string;
  providerId: string | null;
  statusKind: TabStatusKind | null;
  statusLabel: string;
  ariaLabel: string;
}

function defaultClock(): TabClock {
  return { now: Date.now(), perfNow: performance.now() };
}

interface MetaLabels {
  context: string | null;
  todos: string | null;
  subagents: string | null;
}

function metaLabels(item: TabOverviewItem): MetaLabels {
  const agents = item.runningSubagents;
  return {
    context: item.contextPercent !== null ? `Kontext zu ${Math.round(item.contextPercent)} % belegt` : null,
    todos: item.todos ? `Aufgaben: ${item.todos.done} von ${item.todos.total} erledigt` : null,
    subagents: agents > 0 ? (agents === 1 ? '1 Subagent läuft' : `${agents} Subagenten laufen`) : null,
  };
}

/**
 * "Offene Chats": every open tab as a row with provider, full title, model,
 * live status and progress. Rows are kept per tab and patched in place, so
 * the running clock ticks without rebuilding rows or losing keyboard focus.
 */
export class TabOverview {
  readonly containerEl: HTMLElement;
  readonly buttonEl: HTMLButtonElement;
  private readonly buttonCountEl: HTMLElement;
  private readonly panelEl: HTMLElement;
  private readonly summaryEl: HTMLElement;
  private readonly searchEl: HTMLInputElement;
  private readonly listEl: HTMLElement;
  private readonly emptyEl: HTMLElement;
  private readonly newTabEl: HTMLButtonElement;
  private readonly callbacks: TabOverviewCallbacks;
  private readonly clock: () => TabClock;
  private rows = new Map<TabId, OverviewRow>();
  private items: TabOverviewItem[] = [];
  private visibleItems: TabOverviewItem[] = [];
  private query = '';
  private confirmingId: TabId | null = null;
  private tickHandle: number | null = null;
  private openState = false;
  private returnFocusEl: HTMLElement | null = null;

  constructor(parentEl: HTMLElement, callbacks: TabOverviewCallbacks, options: TabOverviewOptions = {}) {
    this.callbacks = callbacks;
    this.clock = options.clock ?? defaultClock;
    const sequence = ++overviewSequence;
    const panelId = `claudian-tab-overview-${sequence}`;
    const titleId = `claudian-tab-overview-title-${sequence}`;

    this.containerEl = parentEl.createDiv({ cls: 'claudian-tab-overview-container' });
    this.buttonEl = this.containerEl.createEl('button', {
      cls: 'claudian-header-btn claudian-tab-overview-btn claudian-hidden',
      attr: {
        type: 'button',
        'aria-haspopup': 'dialog',
        'aria-expanded': 'false',
        'aria-controls': panelId,
        'aria-label': 'Offene Chats',
        title: 'Offene Chats anzeigen',
      },
    });
    const buttonIconEl = this.buttonEl.createSpan({ cls: 'claudian-tab-overview-btn-icon' });
    buttonIconEl.setAttribute('aria-hidden', 'true');
    setIcon(buttonIconEl, 'list');
    this.buttonCountEl = this.buttonEl.createSpan({ cls: 'claudian-tab-overview-btn-count' });
    this.buttonCountEl.setAttribute('aria-hidden', 'true');
    this.buttonEl.addEventListener('click', (event) => {
      event.stopPropagation();
      this.toggle();
    });

    this.panelEl = this.containerEl.createDiv({ cls: 'claudian-tab-overview' });
    this.panelEl.id = panelId;
    this.panelEl.setAttribute('role', 'dialog');
    this.panelEl.setAttribute('aria-labelledby', titleId);
    this.panelEl.setAttribute('aria-hidden', 'true');
    // Clicks inside must not reach the document listener that closes popovers.
    this.panelEl.addEventListener('click', (event) => event.stopPropagation());
    this.panelEl.addEventListener('keydown', (event) => this.handleKeydown(event));

    const headerEl = this.panelEl.createDiv({ cls: 'claudian-tab-overview-header' });
    const headerTopEl = headerEl.createDiv({ cls: 'claudian-tab-overview-header-top' });
    const titleEl = headerTopEl.createSpan({ cls: 'claudian-tab-overview-heading', text: 'Offene Chats' });
    titleEl.id = titleId;
    this.summaryEl = headerTopEl.createSpan({ cls: 'claudian-tab-overview-summary' });
    this.summaryEl.setAttribute('aria-live', 'polite');

    const searchWrapEl = headerEl.createDiv({ cls: 'claudian-tab-overview-search' });
    const searchIconEl = searchWrapEl.createSpan({ cls: 'claudian-tab-overview-search-icon' });
    searchIconEl.setAttribute('aria-hidden', 'true');
    setIcon(searchIconEl, 'search');
    this.searchEl = searchWrapEl.createEl('input', {
      cls: 'claudian-tab-overview-search-input',
      attr: {
        type: 'text',
        placeholder: 'Tabs filtern …',
        'aria-label': 'Offene Chats filtern',
        spellcheck: 'false',
        autocomplete: 'off',
      },
    });
    this.searchEl.addEventListener('input', () => {
      this.query = this.searchEl.value;
      this.refresh();
    });

    this.listEl = this.panelEl.createDiv({ cls: 'claudian-tab-overview-list' });
    this.listEl.setAttribute('role', 'list');
    this.emptyEl = this.panelEl.createDiv({ cls: 'claudian-tab-overview-empty claudian-hidden' });

    const footerEl = this.panelEl.createDiv({ cls: 'claudian-tab-overview-footer' });
    this.newTabEl = footerEl.createEl('button', {
      cls: 'claudian-tab-overview-new',
      attr: { type: 'button' },
    });
    const newTabIconEl = this.newTabEl.createSpan({ cls: 'claudian-tab-overview-new-icon' });
    newTabIconEl.setAttribute('aria-hidden', 'true');
    setIcon(newTabIconEl, 'plus');
    this.newTabEl.createSpan({ text: 'Neuer Tab' });
    this.newTabEl.addEventListener('click', () => {
      if (this.newTabEl.disabled) return;
      this.close({ restoreFocus: false });
      this.callbacks.onNewTab();
    });

    const hintsEl = footerEl.createDiv({ cls: 'claudian-tab-overview-hints' });
    hintsEl.setAttribute('aria-hidden', 'true');
    const mod = Platform.isMacOS ? '⌘' : 'Ctrl';
    for (const [keys, label] of [['↑↓', 'Wählen'], ['↵', 'Öffnen'], [`${mod} 1–${GO_TO_TAB_COMMAND_COUNT}`, 'Direkt']]) {
      const hintEl = hintsEl.createSpan({ cls: 'claudian-tab-overview-hint' });
      hintEl.createEl('kbd', { text: keys });
      hintEl.createSpan({ text: label });
    }
  }

  isOpen(): boolean {
    return this.openState;
  }

  /** Called on every tab bar update, open or not: count and attention on the button. */
  syncButton(tabCount: number, waitingCount: number): void {
    this.buttonEl.toggleClass('claudian-hidden', tabCount < 2);
    this.buttonEl.toggleClass('has-attention', waitingCount > 0);
    const count = String(tabCount);
    if (this.buttonCountEl.textContent !== count) this.buttonCountEl.setText(count);
    const waiting = waitingCount === 0 ? '' : `, ${waitingCount} ${waitingCount === 1 ? 'wartet' : 'warten'} auf dich`;
    this.buttonEl.setAttribute('aria-label', `Offene Chats: ${tabCount}${waiting}`);
  }

  open(): void {
    if (this.openState) {
      this.searchEl.focus();
      return;
    }
    const active = this.containerEl.ownerDocument?.activeElement as HTMLElement | null | undefined;
    this.returnFocusEl = active && typeof active.focus === 'function' ? active : null;
    this.openState = true;
    this.query = '';
    this.searchEl.value = '';
    this.confirmingId = null;
    this.panelEl.addClass('visible');
    this.panelEl.setAttribute('aria-hidden', 'false');
    this.buttonEl.setAttribute('aria-expanded', 'true');
    this.callbacks.onOpen?.();
    this.refresh();
    this.searchEl.focus();
    const activeRow = this.visibleItems.find((item) => item.isActive);
    if (activeRow) this.rows.get(activeRow.id)?.el.scrollIntoView?.({ block: 'nearest' });
    this.startTicking();
  }

  /** Returns whether it was open, so Escape handlers know it consumed the key. */
  close(options: { restoreFocus?: boolean } = {}): boolean {
    if (!this.openState) return false;
    this.openState = false;
    this.stopTicking();
    this.setConfirming(null);
    this.panelEl.removeClass('visible');
    this.panelEl.setAttribute('aria-hidden', 'true');
    this.buttonEl.setAttribute('aria-expanded', 'false');
    const returnTo = this.returnFocusEl;
    this.returnFocusEl = null;
    if (options.restoreFocus !== false) {
      const target = returnTo && returnTo.isConnected !== false ? returnTo : this.buttonEl;
      target.focus();
    }
    return true;
  }

  toggle(): void {
    if (this.openState) this.close();
    else this.open();
  }

  /** Re-reads the tabs and patches rows; cheap enough to run every second while open. */
  refresh(): void {
    if (!this.openState) return;
    const clock = this.clock();
    this.items = this.callbacks.getItems();
    const summary = summarizeTabOverview(this.items);
    if (this.summaryEl.textContent !== summary) this.summaryEl.setText(summary);
    this.visibleItems = filterTabOverviewItems(this.items, this.query, clock);

    const next = new Map<TabId, OverviewRow>();
    this.visibleItems.forEach((item, position) => {
      const row = this.rows.get(item.id) ?? this.createRow(item);
      this.patchRow(row, item, clock);
      next.set(item.id, row);
      const atPosition = this.listEl.children[position] ?? null;
      if (atPosition !== row.el) this.listEl.insertBefore(row.el, atPosition);
    });
    for (const [id, row] of this.rows) {
      if (!next.has(id)) row.el.remove();
    }
    this.rows = next;
    if (this.confirmingId && !next.has(this.confirmingId)) this.confirmingId = null;

    const isEmpty = this.visibleItems.length === 0;
    this.emptyEl.toggleClass('claudian-hidden', !isEmpty);
    if (isEmpty) this.emptyEl.setText(this.query.trim() ? `Kein Tab passt zu „${this.query.trim()}“` : 'Keine offenen Tabs');

    const canCreate = this.callbacks.canCreateTab();
    this.newTabEl.disabled = !canCreate;
    if (canCreate) this.newTabEl.removeAttribute('title');
    else this.newTabEl.setAttribute('title', 'Tab-Limit erreicht – in den Einstellungen erhöhen');
  }

  destroy(): void {
    this.stopTicking();
    this.rows.clear();
    this.containerEl.remove();
  }

  private startTicking(): void {
    this.stopTicking();
    const view = this.containerEl.ownerDocument?.defaultView;
    if (!view) return;
    this.tickHandle = view.setInterval(() => this.refresh(), TICK_MS);
  }

  private stopTicking(): void {
    if (this.tickHandle === null) return;
    this.containerEl.ownerDocument?.defaultView?.clearInterval(this.tickHandle);
    this.tickHandle = null;
  }

  private select(tabId: TabId): void {
    this.close({ restoreFocus: false });
    this.callbacks.onSelect(tabId);
  }

  private requestClose(item: TabOverviewItem): void {
    if (!item.canClose) return;
    if (item.isStreaming) {
      this.setConfirming(item.id);
      this.rows.get(item.id)?.confirmStopEl.focus();
      return;
    }
    this.callbacks.onClose(item.id);
    this.searchEl.focus();
  }

  private setConfirming(tabId: TabId | null): void {
    this.confirmingId = tabId;
    for (const [id, row] of this.rows) {
      const confirming = id === tabId;
      row.el.toggleClass('is-confirming', confirming);
      row.confirmEl.toggleClass('claudian-hidden', !confirming);
    }
  }

  private handleKeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.isComposing) return;
    const target = event.target as HTMLElement | null;

    // The view turns Shift+Tab into plan mode from anywhere; here it moves focus.
    if (event.key === 'Tab') {
      event.stopPropagation();
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      const confirming = this.confirmingId;
      if (confirming) {
        this.setConfirming(null);
        this.rows.get(confirming)?.closeEl.focus();
        return;
      }
      this.close();
      return;
    }

    if ((event.metaKey || event.ctrlKey) && !event.altKey && /^[1-9]$/.test(event.key)) {
      const pick = this.items.find((item) => item.index === Number(event.key));
      if (pick) {
        event.preventDefault();
        this.select(pick.id);
      }
      return;
    }

    const mains = this.visibleItems.flatMap((item) => {
      const row = this.rows.get(item.id);
      return row ? [row.mainEl] : [];
    });
    const index = target ? mains.indexOf(target as HTMLButtonElement) : -1;
    const inSearch = target === this.searchEl;
    const focusAt = (position: number): void => {
      event.preventDefault();
      mains[position]?.focus();
    };

    switch (event.key) {
      case 'ArrowDown':
        if (inSearch) focusAt(0);
        else if (index >= 0) focusAt(Math.min(index + 1, mains.length - 1));
        break;
      case 'ArrowUp':
        if (index > 0) focusAt(index - 1);
        else if (index === 0) {
          event.preventDefault();
          this.searchEl.focus();
        }
        break;
      case 'Home':
        if (index >= 0) focusAt(0);
        break;
      case 'End':
        if (index >= 0) focusAt(mains.length - 1);
        break;
      case 'Enter':
        if (inSearch && this.visibleItems[0]) {
          event.preventDefault();
          this.select(this.visibleItems[0].id);
        }
        break;
      case 'Delete':
      case 'Backspace':
        if (index >= 0) {
          event.preventDefault();
          this.requestClose(this.visibleItems[index]);
        }
        break;
      default:
        break;
    }
  }

  private createRow(item: TabOverviewItem): OverviewRow {
    const el = this.listEl.createDiv({ cls: 'claudian-tab-overview-row' });
    el.setAttribute('role', 'listitem');
    el.setAttribute('data-tab-id', item.id);

    const avatarEl = el.createSpan({ cls: 'claudian-tab-overview-avatar' });
    avatarEl.setAttribute('aria-hidden', 'true');

    const mainEl = el.createEl('button', { cls: 'claudian-tab-overview-main', attr: { type: 'button' } });
    const titleEl = mainEl.createSpan({ cls: 'claudian-tab-overview-title' });
    const modelEl = mainEl.createSpan({ cls: 'claudian-tab-overview-model' });
    const detailEl = mainEl.createSpan({ cls: 'claudian-tab-overview-detail' });
    const statusEl = detailEl.createSpan({ cls: 'claudian-tab-overview-status' });
    const statusMarkEl = statusEl.createSpan({ cls: 'claudian-tab-overview-status-mark' });
    const statusTextEl = statusEl.createSpan({ cls: 'claudian-tab-overview-status-text' });
    const metaEl = detailEl.createSpan({ cls: 'claudian-tab-overview-meta' });

    const sideEl = el.createDiv({ cls: 'claudian-tab-overview-side' });
    const keyEl = sideEl.createEl('kbd', { cls: 'claudian-tab-overview-key' });
    keyEl.setAttribute('aria-hidden', 'true');
    const closeEl = sideEl.createEl('button', { cls: 'claudian-tab-overview-close', attr: { type: 'button' } });
    setIcon(closeEl, 'x');

    const confirmEl = el.createDiv({ cls: 'claudian-tab-overview-confirm claudian-hidden' });
    confirmEl.createSpan({ cls: 'claudian-tab-overview-confirm-text', text: 'Arbeitet noch – Antwort abbrechen?' });
    const confirmStopEl = confirmEl.createEl('button', {
      cls: 'claudian-tab-overview-confirm-stop',
      text: 'Stoppen & schließen',
      attr: { type: 'button' },
    });
    const confirmKeepEl = confirmEl.createEl('button', {
      cls: 'claudian-tab-overview-confirm-keep',
      text: 'Behalten',
      attr: { type: 'button' },
    });

    const row: OverviewRow = {
      el, avatarEl, mainEl, titleEl, modelEl, statusMarkEl, statusTextEl, metaEl, keyEl, closeEl, confirmEl, confirmStopEl,
      item, signature: '', providerId: null, statusKind: null, statusLabel: '', ariaLabel: '',
    };
    // Handlers read row.item, which every patch replaces.
    mainEl.addEventListener('click', () => this.select(row.item.id));
    closeEl.addEventListener('click', (event) => {
      event.stopPropagation();
      this.requestClose(row.item);
    });
    confirmStopEl.addEventListener('click', () => {
      this.setConfirming(null);
      this.callbacks.onClose(row.item.id);
      this.searchEl.focus();
    });
    confirmKeepEl.addEventListener('click', () => {
      this.setConfirming(null);
      row.closeEl.focus();
    });
    return row;
  }

  private patchRow(row: OverviewRow, item: TabOverviewItem, clock: TabClock): void {
    row.item = item;
    const modelLine = composeModelLine(item.providerName, item.modelLabel);
    const signature = tabOverviewRowSignature(item);
    if (signature !== row.signature) {
      row.signature = signature;
      row.el.setAttribute('data-provider', item.providerId);
      row.el.toggleClass('is-active', item.isActive);
      if (row.providerId !== item.providerId) {
        row.providerId = item.providerId;
        // One variable instead of a selector per provider, so new providers need no CSS.
        row.el.setCssProps({ '--claudian-tab-provider': `var(--claudian-brand-${item.providerId}, var(--text-muted))` });
        this.renderAvatar(row.avatarEl, item.providerId);
      }
      row.titleEl.setText(item.title);
      row.titleEl.setAttribute('title', item.title);
      row.modelEl.setText(modelLine);
      if (item.isActive) row.mainEl.setAttribute('aria-current', 'true');
      else row.mainEl.removeAttribute('aria-current');
      const hasKey = item.index <= GO_TO_TAB_COMMAND_COUNT;
      row.keyEl.toggleClass('claudian-hidden', !hasKey);
      if (hasKey) row.keyEl.setText(String(item.index));
      row.closeEl.toggleClass('claudian-hidden', !item.canClose);
      row.closeEl.setAttribute('aria-label', `„${item.title}“ schließen`);
      row.closeEl.setAttribute('title', 'Tab schließen (Entf)');
      this.renderMeta(row.metaEl, item);
    }

    const status = describeTabStatus(item, clock);
    if (status.kind !== row.statusKind) {
      row.statusKind = status.kind;
      row.el.setAttribute('data-state', status.kind);
      row.statusMarkEl.empty();
      if (status.kind === 'draft') setDraftIcon(row.statusMarkEl);
    }
    if (status.label !== row.statusLabel) {
      row.statusLabel = status.label;
      row.statusTextEl.setText(status.label);
    }
    const meta = metaLabels(item);
    const ariaLabel = [item.title, modelLine, status.label, meta.context, meta.todos, meta.subagents, item.isActive ? 'aktueller Tab' : '']
      .filter(Boolean)
      .join(', ');
    if (ariaLabel !== row.ariaLabel) {
      row.ariaLabel = ariaLabel;
      row.mainEl.setAttribute('aria-label', ariaLabel);
    }
  }

  private renderAvatar(avatarEl: HTMLElement, providerId: string): void {
    avatarEl.empty();
    const icon = ProviderRegistry.getProviderRegistrationSafe(providerId)?.chatUIConfig?.getProviderIcon?.();
    if (!icon) {
      setIcon(avatarEl, 'message-square');
      return;
    }
    avatarEl.appendChild(createProviderIconSvg(icon, {
      width: 16,
      height: 16,
      className: 'claudian-tab-overview-avatar-icon',
      dataProvider: providerId,
      ownerDocument: avatarEl.ownerDocument,
    }));
  }

  private renderMeta(metaEl: HTMLElement, item: TabOverviewItem): void {
    metaEl.empty();
    const labels = metaLabels(item);
    if (labels.context && item.contextPercent !== null) {
      const percent = Math.round(Math.min(100, Math.max(0, item.contextPercent)));
      const chip = this.createChip(metaEl, 'context', labels.context);
      chip.toggleClass('is-high', percent >= HIGH_CONTEXT_PERCENT);
      const fillEl = chip.createSpan({ cls: 'claudian-tab-overview-meter' })
        .createSpan({ cls: 'claudian-tab-overview-meter-fill' });
      fillEl.setCssProps({ '--claudian-tab-meter': String(percent / 100) });
      chip.createSpan({ cls: 'claudian-tab-overview-chip-text', text: `${percent}%` });
    }
    if (labels.todos && item.todos) {
      const chip = this.createChip(metaEl, 'todos', labels.todos, 'list-checks');
      chip.toggleClass('is-complete', item.todos.done === item.todos.total);
      chip.createSpan({ cls: 'claudian-tab-overview-chip-text', text: `${item.todos.done}/${item.todos.total}` });
    }
    if (labels.subagents) {
      const chip = this.createChip(metaEl, 'subagents', labels.subagents, 'bot');
      chip.createSpan({ cls: 'claudian-tab-overview-chip-text', text: String(item.runningSubagents) });
    }
    metaEl.toggleClass('claudian-hidden', metaEl.children.length === 0);
  }

  private createChip(metaEl: HTMLElement, kind: string, label: string, icon?: string): HTMLElement {
    const chip = metaEl.createSpan({ cls: `claudian-tab-overview-chip claudian-tab-overview-chip--${kind}` });
    chip.setAttribute('aria-label', label);
    chip.setAttribute('title', label);
    if (icon) {
      const iconEl = chip.createSpan({ cls: 'claudian-tab-overview-chip-icon' });
      iconEl.setAttribute('aria-hidden', 'true');
      setIcon(iconEl, icon);
    }
    return chip;
  }
}
