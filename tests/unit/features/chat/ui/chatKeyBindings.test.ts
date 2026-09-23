import {
  CHAT_KEY_BINDINGS,
  type ChatKeyBindingId,
  chatKeyBindingScopeModifiers,
  formatChatKeyBinding,
  matchesChatKeyBinding,
} from '@/features/chat/ui/chatKeyBindings';

function keyEvent(overrides: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    key: '',
    code: '',
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    isComposing: false,
    ...overrides,
  } as KeyboardEvent;
}

describe('matchesChatKeyBinding', () => {
  it('accepts Cmd or Ctrl as the platform modifier', () => {
    expect(matchesChatKeyBinding(keyEvent({ key: 'f', metaKey: true }), 'search')).toBe(true);
    expect(matchesChatKeyBinding(keyEvent({ key: 'F', ctrlKey: true }), 'search')).toBe(true);
    expect(matchesChatKeyBinding(keyEvent({ key: 'f' }), 'search')).toBe(false);
  });

  it('leaves Cmd+Shift+F to Obsidian’s global search', () => {
    expect(matchesChatKeyBinding(keyEvent({ key: 'f', metaKey: true, shiftKey: true }), 'search')).toBe(false);
  });

  it('opens the shortcut list for a slash typed with Shift, as on German keyboards', () => {
    expect(matchesChatKeyBinding(keyEvent({ key: '/', code: 'Digit7', metaKey: true, shiftKey: true }), 'shortcuts')).toBe(true);
    expect(matchesChatKeyBinding(keyEvent({ key: '-', code: 'Slash', ctrlKey: true }), 'shortcuts')).toBe(true);
  });

  it('keeps Ctrl+Shift+Tab for Obsidian’s tab switching instead of plan mode', () => {
    expect(matchesChatKeyBinding(keyEvent({ key: 'Tab', shiftKey: true }), 'plan-mode')).toBe(true);
    expect(matchesChatKeyBinding(keyEvent({ key: 'Tab', shiftKey: true, ctrlKey: true }), 'plan-mode')).toBe(false);
    expect(matchesChatKeyBinding(keyEvent({ key: 'Tab' }), 'plan-mode')).toBe(false);
  });

  it('never fires while an IME composition is open', () => {
    expect(matchesChatKeyBinding(keyEvent({ key: 'Tab', shiftKey: true, isComposing: true }), 'plan-mode')).toBe(false);
  });
});

describe('formatChatKeyBinding', () => {
  it('writes macOS glyphs', () => {
    const labels = Object.fromEntries(
      (Object.keys(CHAT_KEY_BINDINGS) as ChatKeyBindingId[]).map((id) => [id, formatChatKeyBinding(id, true)]),
    );
    expect(labels).toEqual({
      send: '⌘ ↵',
      newline: '⇧ ↵',
      stop: 'Esc',
      search: '⌘ F',
      'plan-mode': '⇧ Tab',
      shortcuts: '⌘ /',
    });
  });

  it('writes Ctrl elsewhere', () => {
    expect(formatChatKeyBinding('send', false)).toBe('Ctrl ↵');
    expect(formatChatKeyBinding('newline', false)).toBe('⇧ ↵');
  });
});

describe('chatKeyBindingScopeModifiers', () => {
  it('translates the table into Obsidian scope modifiers', () => {
    expect(chatKeyBindingScopeModifiers('send')).toEqual(['Mod']);
    expect(chatKeyBindingScopeModifiers('stop')).toEqual([]);
  });
});
