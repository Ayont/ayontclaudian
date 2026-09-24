import { createMockEl } from '@test/helpers/mockElement';

import {
  countTextLines,
  makeUserTextCollapsible,
  shouldCollapseUserText,
  USER_TEXT_COLLAPSE_CHARS,
  USER_TEXT_COLLAPSE_LINES,
} from '@/features/chat/rendering/collapsibleUserText';
import { setLocale } from '@/i18n/i18n';

const longByLines = Array.from({ length: USER_TEXT_COLLAPSE_LINES + 6 }, (_, i) => `Zeile ${i + 1}`).join('\n');

describe('collapsibleUserText', () => {
  beforeEach(() => {
    setLocale('de');
  });

  it('counts lines including a trailing partial line', () => {
    expect(countTextLines('')).toBe(0);
    expect(countTextLines('eins')).toBe(1);
    expect(countTextLines('eins\nzwei\ndrei')).toBe(3);
    expect(countTextLines('eins\r\nzwei')).toBe(2);
  });

  it('keeps short prompts fully visible', () => {
    expect(shouldCollapseUserText('Bau mir bitte eine Übersicht.')).toBe(false);
  });

  it('collapses a message with many lines', () => {
    expect(shouldCollapseUserText(longByLines)).toBe(true);
  });

  it('collapses one long paragraph that has no line breaks', () => {
    expect(shouldCollapseUserText('a'.repeat(USER_TEXT_COLLAPSE_CHARS + 1))).toBe(true);
  });

  it('leaves a short bubble untouched', () => {
    const contentEl = createMockEl();
    const textEl = contentEl.createDiv({ cls: 'claudian-text-block' });

    makeUserTextCollapsible(contentEl, textEl, 'kurz');

    expect(textEl.hasClass('is-collapsible')).toBe(false);
    expect(contentEl.querySelector('.claudian-user-text-toggle')).toBeNull();
  });

  it('collapses a long bubble behind a German "Mehr anzeigen" toggle', () => {
    const contentEl = createMockEl();
    const textEl = contentEl.createDiv({ cls: 'claudian-text-block' });

    makeUserTextCollapsible(contentEl, textEl, longByLines);

    expect(textEl.hasClass('is-collapsible')).toBe(true);
    expect(textEl.hasClass('is-collapsed')).toBe(true);
    const toggle = contentEl.querySelector('.claudian-user-text-toggle');
    expect(toggle).not.toBeNull();
    expect(toggle!.getAttribute('aria-expanded')).toBe('false');
    expect(toggle!.textContent).toContain('Mehr anzeigen');
    expect(toggle!.textContent).toContain(`${USER_TEXT_COLLAPSE_LINES + 6} Zeilen`);
  });

  it('expands and collapses again on click', () => {
    const contentEl = createMockEl();
    const textEl = contentEl.createDiv({ cls: 'claudian-text-block' });
    makeUserTextCollapsible(contentEl, textEl, longByLines);
    const toggle = contentEl.querySelector('.claudian-user-text-toggle')!;

    toggle.click();
    expect(textEl.hasClass('is-collapsed')).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.textContent).toContain('Weniger anzeigen');

    toggle.click();
    expect(textEl.hasClass('is-collapsed')).toBe(true);
    expect(toggle.textContent).toContain('Mehr anzeigen');
  });

  it('follows the interface language', () => {
    setLocale('en');
    const contentEl = createMockEl();
    const textEl = contentEl.createDiv({ cls: 'claudian-text-block' });

    makeUserTextCollapsible(contentEl, textEl, longByLines);

    expect(contentEl.querySelector('.claudian-user-text-toggle')!.textContent).toContain('Show more');
  });

  it('does not stack a second toggle when the same bubble is refreshed', () => {
    const contentEl = createMockEl();
    const textEl = contentEl.createDiv({ cls: 'claudian-text-block' });

    makeUserTextCollapsible(contentEl, textEl, longByLines);
    makeUserTextCollapsible(contentEl, textEl, longByLines);

    expect(contentEl.querySelectorAll('.claudian-user-text-toggle')).toHaveLength(1);
  });
});
