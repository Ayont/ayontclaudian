import { Platform, setIcon } from 'obsidian';

import { GO_TO_TAB_COMMAND_COUNT } from '../tabs/tabCommands';
import { type ChatKeyBindingId, formatChatKeyBinding } from './chatKeyBindings';

let shortcutOverlayId = 0;

/** What a row promises: a bound key, a slash command, or an Obsidian command. */
export type ShortcutTrigger =
  | { kind: 'key'; binding: ChatKeyBindingId }
  | { kind: 'slash'; command: string }
  | { kind: 'command'; commandIds: readonly string[] };

export interface ShortcutEntry {
  id: string;
  keys: string;
  label: string;
  group: string;
  trigger: ShortcutTrigger;
}

const COMMAND_KEYS_LABEL = 'Befehl';
const COMMAND_KEYS_HINT = 'Kein Standard-Hotkey – in Obsidian unter Einstellungen → Tastenkürzel festlegen';
const TAB_GROUP = 'Tabs';

function key(id: string, binding: ChatKeyBindingId, label: string, group: string): ShortcutEntry {
  return { id, keys: formatChatKeyBinding(binding, Platform.isMacOS), label, group, trigger: { kind: 'key', binding } };
}

function command(id: string, commandIds: readonly string[], label: string): ShortcutEntry {
  return { id, keys: COMMAND_KEYS_LABEL, label, group: TAB_GROUP, trigger: { kind: 'command', commandIds } };
}

export const CHAT_SHORTCUTS: readonly ShortcutEntry[] = [
  key('send', 'send', 'Nachricht senden', 'Chat'),
  key('newline', 'newline', 'Neue Zeile', 'Chat'),
  key('stop', 'stop', 'Antwort stoppen', 'Chat'),
  key('search', 'search', 'Im Chat suchen', 'Navigation'),
  key('plan', 'plan-mode', 'Plan-Modus umschalten', 'Modi'),
  { id: 'speed', keys: '/fast', label: 'Speed-Modus umschalten', group: 'Modi', trigger: { kind: 'slash', command: 'fast' } },
  key('shortcuts', 'shortcuts', 'Tastenkürzel', 'Modi'),
  command('tab-overview', ['open-tab-overview'], 'Tab-Übersicht öffnen'),
  command('next-tab', ['next-chat-tab'], 'Nächster Chat-Tab'),
  command('previous-tab', ['previous-chat-tab'], 'Vorheriger Chat-Tab'),
  command(
    'go-to-tab',
    Array.from({ length: GO_TO_TAB_COMMAND_COUNT }, (_, index) => `open-chat-tab-${index + 1}`),
    `Chat-Tab 1–${GO_TO_TAB_COMMAND_COUNT} öffnen`,
  ),
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
  private previousFocus: HTMLElement | null = null;

  constructor(host: HTMLElement) {
    this.root = host.createDiv({ cls: 'claudian-shortcuts' });
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-hidden', 'true');

    const panel = this.root.createDiv({ cls: 'claudian-shortcuts-panel' });
    const header = panel.createDiv({ cls: 'claudian-shortcuts-header' });
    const titleId = `claudian-shortcuts-title-${++shortcutOverlayId}`;
    const title = header.createEl('h2', { text: 'Tastenkürzel', cls: 'claudian-shortcuts-title' });
    title.id = titleId;
    this.root.setAttribute('aria-labelledby', titleId);
    const closeButton = header.createEl('button', {
      cls: 'claudian-shortcuts-close',
      attr: { type: 'button', 'aria-label': 'Tastenkürzel schließen' },
    });
    setIcon(closeButton, 'x');
    closeButton.addEventListener('click', () => this.close());

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
    this.root.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        this.close();
        return;
      }
      if (event.key === 'Tab') {
        this.keepFocusInside(event);
      }
    });
    this.renderRows();
  }

  isOpen(): boolean {
    return this.openState;
  }

  open(): void {
    const activeElement = this.root.ownerDocument.activeElement;
    this.previousFocus = activeElement && typeof (activeElement as HTMLElement).focus === 'function'
      ? activeElement as HTMLElement
      : null;
    this.openState = true;
    this.root.addClass('is-open');
    this.root.setAttribute('aria-hidden', 'false');
    this.searchEl.value = '';
    this.renderRows();
    this.searchEl.focus?.();
  }

  close(): void {
    if (!this.openState) return;
    this.openState = false;
    this.root.removeClass('is-open');
    this.root.setAttribute('aria-hidden', 'true');
    const returnTarget = this.previousFocus;
    this.previousFocus = null;
    if (returnTarget?.isConnected !== false) {
      returnTarget?.focus();
    }
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
        if (entry.group === TAB_GROUP) {
          this.listEl.createDiv({
            cls: 'claudian-shortcuts-note',
            text: 'Befehle ohne Standard-Hotkey: über die Befehlspalette aufrufen oder unter Einstellungen → Tastenkürzel einen Hotkey festlegen.',
          });
        }
      }
      const row = this.listEl.createDiv({ cls: 'claudian-shortcuts-row' });
      row.createSpan({ cls: 'claudian-shortcuts-label', text: entry.label });
      const isCommand = entry.trigger.kind === 'command';
      const keysEl = row.createSpan({
        cls: `claudian-shortcuts-keys${isCommand ? ' claudian-shortcuts-keys--command' : ''}`,
        text: entry.keys,
      });
      if (isCommand) keysEl.setAttribute('title', COMMAND_KEYS_HINT);
    }
  }

  private keepFocusInside(event: KeyboardEvent): void {
    const focusable = Array.from(this.root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    )).filter((element) => element.offsetParent !== null || element === this.root.ownerDocument.activeElement);
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = this.root.ownerDocument.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }
}
