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
});
