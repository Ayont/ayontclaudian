import { setIcon } from 'obsidian';

import {
  describeUpdateHeadline,
  type UpdateItem,
  type UpdateSessionState,
  visibleItems,
} from '../../../app/update/UpdateSession';

export interface UpdateDockOptions {
  mountEl: HTMLElement;
  onStartAll: () => void;
  onStartOne: (id: string) => void;
  onDismiss: (id: string) => void;
}

/**
 * In-chat live update card. Replaces blocking confirm()/Notice popups so the
 * user can watch Claude Code and the other CLIs install in place.
 */
export class UpdateDock {
  private readonly rootEl: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly listEl: HTMLElement;
  private readonly actionsEl: HTMLElement;
  private state: UpdateSessionState = { items: [] };

  constructor(private readonly options: UpdateDockOptions) {
    this.rootEl = options.mountEl.createDiv({ cls: 'claudian-update-dock claudian-hidden' });
    this.rootEl.setAttribute('role', 'status');
    this.rootEl.setAttribute('aria-live', 'polite');

    const head = this.rootEl.createDiv({ cls: 'claudian-update-dock-head' });
    const iconEl = head.createSpan({ cls: 'claudian-update-dock-icon' });
    setIcon(iconEl, 'download');
    this.titleEl = head.createDiv({ cls: 'claudian-update-dock-title' });
    this.listEl = this.rootEl.createDiv({ cls: 'claudian-update-dock-list' });
    this.actionsEl = this.rootEl.createDiv({ cls: 'claudian-update-dock-actions' });
  }

  setState(state: UpdateSessionState): void {
    this.state = state;
    this.render();
  }

  private render(): void {
    const items = visibleItems(this.state);
    this.rootEl.toggleClass('claudian-hidden', items.length === 0);
    this.rootEl.toggleClass('is-running', items.some((item) => item.status === 'running'));
    this.titleEl.setText(describeUpdateHeadline(this.state) || 'Updates');

    this.listEl.empty();
    for (const item of items) {
      this.renderItem(item);
    }

    this.actionsEl.empty();
    const available = items.filter((item) => item.status === 'available');
    if (available.length > 0 && !items.some((item) => item.status === 'running' || item.status === 'queued')) {
      const startAll = this.actionsEl.createEl('button', {
        cls: 'claudian-update-dock-start-all',
        text: available.length > 1 ? 'Alle aktualisieren' : 'Aktualisieren',
      });
      startAll.setAttribute('type', 'button');
      startAll.addEventListener('click', (event) => {
        event.stopPropagation();
        this.options.onStartAll();
      });
    }
  }

  private renderItem(item: UpdateItem): void {
    const row = this.listEl.createDiv({ cls: `claudian-update-item is-${item.status}` });

    const body = row.createDiv({ cls: 'claudian-update-item-body' });
    body.createDiv({ cls: 'claudian-update-item-name', text: item.displayName });
    body.createDiv({
      cls: 'claudian-update-item-versions',
      text: `${item.currentVersion} → ${item.latestVersion}`,
    });

    if (item.status === 'running') {
      const meter = row.createDiv({ cls: 'claudian-update-item-meter' });
      meter.createDiv({ cls: 'claudian-update-item-bar' });
      if (item.percent !== null) {
        meter.setCssProps({ '--cl-update-pct': `${item.percent}%` });
        meter.createSpan({ cls: 'claudian-update-item-percent', text: `${item.percent}%` });
      } else {
        meter.addClass('is-indeterminate');
      }
      if (item.logLines.length > 0) {
        const log = row.createDiv({ cls: 'claudian-update-item-log' });
        log.setText(item.logLines.join('\n'));
        log.scrollTop = log.scrollHeight;
      }
    } else if (item.status === 'error' && item.error) {
      row.createDiv({ cls: 'claudian-update-item-error', text: item.error });
    } else if (item.status === 'done') {
      row.createDiv({
        cls: 'claudian-update-item-done',
        text: item.kind === 'plugin' ? `Jetzt ${item.latestVersion}` : 'Fertig',
      });
    }

    const actions = row.createDiv({ cls: 'claudian-update-item-actions' });
    if (item.status === 'available') {
      const start = actions.createEl('button', {
        cls: 'claudian-update-item-start',
        text: 'Aktualisieren',
      });
      start.setAttribute('type', 'button');
      start.addEventListener('click', (event) => {
        event.stopPropagation();
        this.options.onStartOne(item.id);
      });
    }
    if (item.status !== 'running' && item.status !== 'queued') {
      const dismiss = actions.createEl('button', { cls: 'claudian-update-item-dismiss' });
      dismiss.setAttribute('type', 'button');
      dismiss.setAttribute('aria-label', 'Ausblenden');
      setIcon(dismiss, 'x');
      dismiss.addEventListener('click', (event) => {
        event.stopPropagation();
        this.options.onDismiss(item.id);
      });
    }
  }
}
