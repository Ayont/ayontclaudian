import { t } from '../../../i18n/i18n';

/** A pasted mail or log beyond this many lines would push the answer off screen. */
export const USER_TEXT_COLLAPSE_LINES = 14;
/** One long paragraph wraps into many lines without a single break. */
export const USER_TEXT_COLLAPSE_CHARS = 1200;

const TOGGLE_CLASS = 'claudian-user-text-toggle';
const toggles = new WeakMap<HTMLElement, HTMLButtonElement>();

export function countTextLines(text: string): number {
  if (!text) return 0;
  return text.split(/\r\n|\r|\n/).length;
}

export function shouldCollapseUserText(text: string): boolean {
  return countTextLines(text) > USER_TEXT_COLLAPSE_LINES || text.length > USER_TEXT_COLLAPSE_CHARS;
}

export function formatLongTextToggle(expanded: boolean, lines: number): string {
  if (expanded) return t('chat.longText.showLess');
  return `${t('chat.longText.showMore')} · ${t('chat.longText.lines', { count: lines.toLocaleString() })}`;
}

/**
 * Caps a long sent message and puts a toggle under it, so one pasted mail
 * does not bury the conversation. Short messages are left exactly as rendered.
 */
export function makeUserTextCollapsible(parentEl: HTMLElement, textEl: HTMLElement, text: string): void {
  if (!shouldCollapseUserText(text)) return;

  const lines = countTextLines(text);
  textEl.addClass('is-collapsible');
  textEl.addClass('is-collapsed');

  const existing = toggles.get(textEl);
  if (existing) existing.remove();

  const toggle = parentEl.createEl('button', { cls: TOGGLE_CLASS });
  toggle.setAttribute('type', 'button');
  toggles.set(textEl, toggle);

  const render = (): void => {
    const expanded = !textEl.hasClass('is-collapsed');
    toggle.setText(formatLongTextToggle(expanded, lines));
    toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  };

  toggle.addEventListener('click', (event: MouseEvent) => {
    event.stopPropagation();
    textEl.toggleClass('is-collapsed', !textEl.hasClass('is-collapsed'));
    render();
  });
  render();
}
