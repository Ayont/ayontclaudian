import { createMockEl } from '@test/helpers/mockElement';
import { Platform } from 'obsidian';

import { BUILT_IN_COMMANDS } from '@/core/commands/builtInCommands';
import { registerTabNavigationCommands } from '@/features/chat/tabs/tabCommands';
import { formatChatKeyBinding } from '@/features/chat/ui/chatKeyBindings';
import {
  CHAT_SHORTCUTS,
  filterShortcuts,
  ShortcutOverlay,
} from '@/features/chat/ui/ShortcutOverlay';

describe('filterShortcuts', () => {
  it('matches labels and keys case-insensitively', () => {
    const hits = filterShortcuts(CHAT_SHORTCUTS, 'senden');
    expect(hits.some((entry) => entry.id === 'send')).toBe(true);
    expect(filterShortcuts(CHAT_SHORTCUTS, 'zzzz').length).toBe(0);
  });
});

describe('ShortcutOverlay', () => {
  it('is a labelled modal dialog with a real close button', () => {
    const host = createMockEl();
    new ShortcutOverlay(host);

    const root = host.querySelector('.claudian-shortcuts');
    const close = host.querySelector('.claudian-shortcuts-close');
    expect(root?.getAttribute('role')).toBe('dialog');
    expect(root?.getAttribute('aria-modal')).toBe('true');
    expect(root?.getAttribute('aria-labelledby')).toBeTruthy();
    expect(close?.tagName).toBe('BUTTON');
    expect(close?.getAttribute('aria-label')).toBe('Tastenkürzel schließen');
  });

  it('opens, filters, and closes', () => {
    const host = createMockEl();
    const overlay = new ShortcutOverlay(host);

    expect(overlay.isOpen()).toBe(false);
    overlay.open();
    expect(overlay.isOpen()).toBe(true);
    expect(host.querySelector('.claudian-shortcuts')?.hasClass('is-open')).toBe(true);
    expect(host.querySelectorAll('.claudian-shortcuts-row').length).toBe(CHAT_SHORTCUTS.length);

    overlay.close();
    expect(overlay.isOpen()).toBe(false);
  });

  it('toggles visibility', () => {
    const overlay = new ShortcutOverlay(createMockEl());
    overlay.toggle();
    expect(overlay.isOpen()).toBe(true);
    overlay.toggle();
    expect(overlay.isOpen()).toBe(false);
  });

  it('closes on Escape from anywhere inside the dialog', () => {
    const host = createMockEl();
    const overlay = new ShortcutOverlay(host);
    overlay.open();

    host.querySelector('.claudian-shortcuts')?.dispatchEvent({
      type: 'keydown',
      key: 'Escape',
      preventDefault: jest.fn(),
      stopPropagation: jest.fn(),
    });

    expect(overlay.isOpen()).toBe(false);
  });

  it('returns focus to the element that opened it', () => {
    const previousFocus = { focus: jest.fn(), isConnected: true };
    const originalDocument = (globalThis as { document?: unknown }).document;
    (globalThis as { document?: unknown }).document = { activeElement: previousFocus };
    try {
      const overlay = new ShortcutOverlay(createMockEl());
      overlay.open();
      overlay.close();
      expect(previousFocus.focus).toHaveBeenCalled();
    } finally {
      (globalThis as { document?: unknown }).document = originalDocument;
    }
  });
});

// The overlay once listed ⌘N, ⌘⇧H and ⌘K, which nothing was bound to. Key rows
// come from the binding table the handlers use (see the ClaudianView test that
// drives each listed key through its real handler); commands must exist.
describe('CHAT_SHORTCUTS lists only real bindings', () => {
  it('renders every key row from the binding table', () => {
    for (const entry of CHAT_SHORTCUTS) {
      if (entry.trigger.kind !== 'key') continue;
      expect(entry.keys).toBe(formatChatKeyBinding(entry.trigger.binding, Platform.isMacOS));
    }
  });

  it('names only commands the plugin registers, marked as having no default hotkey', () => {
    const registered = new Set<string>();
    registerTabNavigationCommands({
      addCommand: (command) => {
        registered.add(command.id);
        return command;
      },
      getView: () => null,
    });
    const commandRows = CHAT_SHORTCUTS.filter((entry) => entry.trigger.kind === 'command');

    expect(commandRows.length).toBeGreaterThan(0);
    for (const entry of commandRows) {
      if (entry.trigger.kind !== 'command') continue;
      expect(entry.keys).toBe('Befehl');
      for (const id of entry.trigger.commandIds) expect(registered.has(id)).toBe(true);
    }
  });

  it('names only slash commands that exist', () => {
    const names = new Set(BUILT_IN_COMMANDS.map((command) => command.name));
    for (const entry of CHAT_SHORTCUTS) {
      if (entry.trigger.kind !== 'slash') continue;
      expect(names.has(entry.trigger.command)).toBe(true);
      expect(entry.keys).toBe(`/${entry.trigger.command}`);
    }
  });

  it('no longer advertises keys that nothing listens to', () => {
    const keys = CHAT_SHORTCUTS.map((entry) => entry.keys.replace(/\s+/g, ''));
    expect(keys).not.toContain('⌘N');
    expect(keys).not.toContain('⌘⇧H');
    expect(keys).not.toContain('⌘K');
  });

  it('explains how to give a command a hotkey', () => {
    const host = createMockEl();
    const overlay = new ShortcutOverlay(host);
    overlay.open();

    const commandKey = host.querySelectorAll('.claudian-shortcuts-keys')
      .find((element: any) => element.hasClass('claudian-shortcuts-keys--command'));
    expect(commandKey?.textContent).toBe('Befehl');
    expect(commandKey?.getAttribute('title')).toContain('Einstellungen → Tastenkürzel');
    expect(host.querySelector('.claudian-shortcuts-note')?.textContent).toContain('Hotkey');
  });
});
