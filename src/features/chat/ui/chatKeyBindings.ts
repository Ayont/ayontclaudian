import type { Modifier } from 'obsidian';

/**
 * The chat's own key bindings. The handlers match against this table and the
 * shortcut overlay renders from it, so the overlay cannot advertise a key that
 * nothing listens to (it once listed ⌘N, ⌘⇧H and ⌘K, none of which were bound).
 */
export type ChatKeyBindingId = 'send' | 'newline' | 'stop' | 'search' | 'plan-mode' | 'shortcuts';

type ModifierRule = 'required' | 'forbidden' | 'any';

export interface ChatKeyBinding {
  key: string;
  /** Layout-independent physical key, for characters that move between layouts. */
  code?: string;
  /** Cmd on macOS, Ctrl elsewhere. Defaults to forbidden, like shift and alt. */
  mod?: ModifierRule;
  shift?: ModifierRule;
  alt?: ModifierRule;
}

export const CHAT_KEY_BINDINGS: Readonly<Record<ChatKeyBindingId, ChatKeyBinding>> = {
  send: { key: 'Enter', mod: 'required' },
  // Not a handler: the textarea inserts the line because send ignores Shift.
  newline: { key: 'Enter', shift: 'required' },
  stop: { key: 'Escape' },
  // Cmd+Shift+F stays Obsidian's global search.
  search: { key: 'f', mod: 'required' },
  // Ctrl+Shift+Tab stays Obsidian's previous-tab hotkey.
  'plan-mode': { key: 'Tab', shift: 'required' },
  // German and other layouts type "/" with Shift or Alt.
  shortcuts: { key: '/', code: 'Slash', mod: 'required', shift: 'any', alt: 'any' },
};

function allows(rule: ModifierRule | undefined, pressed: boolean): boolean {
  const effective = rule ?? 'forbidden';
  if (effective === 'any') return true;
  return effective === 'required' ? pressed : !pressed;
}

export function matchesChatKeyBinding(event: KeyboardEvent, id: ChatKeyBindingId): boolean {
  if (event.isComposing) return false;
  const binding = CHAT_KEY_BINDINGS[id];
  const keyMatches = (event.key ?? '').toLowerCase() === binding.key.toLowerCase()
    || (binding.code !== undefined && event.code === binding.code);
  if (!keyMatches) return false;
  return allows(binding.mod, !!(event.metaKey || event.ctrlKey))
    && allows(binding.shift, !!event.shiftKey)
    && allows(binding.alt, !!event.altKey);
}

/** Bindings registered on an Obsidian `Scope` instead of a keydown listener. */
export function chatKeyBindingScopeModifiers(id: ChatKeyBindingId): Modifier[] {
  const binding = CHAT_KEY_BINDINGS[id];
  const modifiers: Modifier[] = [];
  if (binding.mod === 'required') modifiers.push('Mod');
  if (binding.shift === 'required') modifiers.push('Shift');
  if (binding.alt === 'required') modifiers.push('Alt');
  return modifiers;
}

const KEY_GLYPHS: Record<string, string> = {
  Enter: '↵',
  Escape: 'Esc',
  Tab: 'Tab',
};

export function formatChatKeyBinding(id: ChatKeyBindingId, isMac: boolean): string {
  const binding = CHAT_KEY_BINDINGS[id];
  const parts: string[] = [];
  if (binding.mod === 'required') parts.push(isMac ? '⌘' : 'Ctrl');
  if (binding.alt === 'required') parts.push(isMac ? '⌥' : 'Alt');
  if (binding.shift === 'required') parts.push('⇧');
  parts.push(KEY_GLYPHS[binding.key] ?? binding.key.toUpperCase());
  return parts.join(' ');
}
