import { setIcon } from 'obsidian';

export interface ShortcutEntry {
  id: string;
  keys: string;
  label: string;
  group: string;
}

export const CHAT_SHORTCUTS: readonly ShortcutEntry[] = [
  { id: 'send', keys: '⌘ ↵', label: 'Nachricht senden', group: 'Chat' },
  { id: 'newline', keys: '⇧ ↵', label: 'Neue Zeile', group: 'Chat' },
  { id: 'stop', keys: 'Esc', label: 'Antwort stoppen', group: 'Chat' },
  { id: 'new-chat', keys: '⌘ N', label: 'Neuer Chat', group: 'Navigation' },
  { id: 'search', keys: '⌘ F', label: 'Im Chat suchen', group: 'Navigation' },
  { id: 'history', keys: '⌘ ⇧ H', label: 'Verlauf öffnen', group: 'Navigation' },
  { id: 'command-center', keys: '⌘ K', label: 'Befehlspalette', group: 'Navigation' },
  { id: 'plan', keys: '⇧ Tab', label: 'Plan-Modus umschalten', group: 'Modi' },
  { id: 'speed', keys: '/fast', label: 'Speed-Modus umschalten', group: 'Modi' },
  { id: 'shortcuts', keys: '⌘ /', label: 'Tastenkürzel', group: 'Modi' },
];

export function filterShortcuts(
  entries: readonly ShortcutEntry[],
  query: string,
): ShortcutEntry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return [...entries];
  }
  return entries.filter((entry) => (
    entry.label.toLowerCase().includes(needle)
    || entry.keys.toLowerCase().includes(needle)
    || entry.group.toLowerCase().includes(needle)
  ));
}

export class ShortcutOverlay {
  private readonly root: HTMLElement;
  private readonly listEl: HTMLElement;
  private readonly searchEl: HTMLInputElement;
  private openState = false;

  constructor(host: HTMLElement) {
    this.root = host.createDiv({ cls: 'claudian-shortcuts' });
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'Tastenkürzel');
    this.root.setAttribute('aria-hidden', 'true');

    const panel = this.root.createDiv({ cls: 'claudian-shortcuts-panel' });
    const header = panel.createDiv({ cls: 'claudian-shortcuts-header' });
    header.createEl('h2', { text: 'Tastenkürzel', cls: 'claudian-shortcuts-title' });

    const searchWrap = panel.createDiv({ cls: 'claudian-shortcuts-search-wrap' });
    const searchIcon = searchWrap.createSpan({ cls: 'claudian-shortcuts-search-icon' });
    setIcon(searchIcon, 'search');
    this.searchEl = searchWrap.createEl('input', {
      cls: 'claudian-shortcuts-search',
      attr: {
        type: 'search',
        placeholder: 'Kürzel suchen…',
        spellcheck: 'false',
      },
    });

    this.listEl = panel.createDiv({ cls: 'claudian-shortcuts-list' });
    this.searchEl.addEventListener('input', () => this.renderRows());
    this.root.addEventListener('click', (event) => {
      if (event.target === this.root) {
        this.close();
      }
    });
    this.renderRows();
  }

  isOpen(): boolean {
    return this.openState;
  }

  open(): void {
    this.openState = true;
    this.root.addClass('is-open');
    this.root.setAttribute('aria-hidden', 'false');
    this.searchEl.value = '';
    this.renderRows();
    this.searchEl.focus?.();
  }

  close(): void {
    this.openState = false;
    this.root.removeClass('is-open');
    this.root.setAttribute('aria-hidden', 'true');
  }

  toggle(): void {
    if (this.openState) {
      this.close();
    } else {
      this.open();
    }
  }

  private renderRows(): void {
    this.listEl.empty();
    const matches = filterShortcuts(CHAT_SHORTCUTS, this.searchEl.value);
    if (matches.length === 0) {
      this.listEl.createDiv({
        cls: 'claudian-shortcuts-empty',
        text: 'Kein Kürzel gefunden',
      });
      return;
    }

    let lastGroup = '';
    for (const entry of matches) {
      if (entry.group !== lastGroup) {
        lastGroup = entry.group;
        this.listEl.createDiv({ cls: 'claudian-shortcuts-group', text: entry.group });
      }
      const row = this.listEl.createDiv({ cls: 'claudian-shortcuts-row' });
      row.createSpan({ cls: 'claudian-shortcuts-label', text: entry.label });
      row.createSpan({ cls: 'claudian-shortcuts-keys', text: entry.keys });
    }
  }
}
