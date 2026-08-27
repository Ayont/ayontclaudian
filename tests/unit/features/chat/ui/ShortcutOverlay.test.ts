import { createMockEl } from '@test/helpers/mockElement';

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
