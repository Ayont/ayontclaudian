import { countTextLines, formatLongTextToggle } from '../rendering/collapsibleUserText';

export const TEXTAREA_BASE_MIN_HEIGHT = 60;
export const TEXTAREA_MIN_MAX_HEIGHT = 150;
/** A large paste must not push the conversation out of view. */
export const TEXTAREA_MAX_HEIGHT_PERCENT = 0.3;
/** Reached only on request, through the composer's "Mehr anzeigen" toggle. */
export const TEXTAREA_EXPANDED_MAX_HEIGHT_PERCENT = 0.6;

const EXPAND_TOGGLE_CLASS = 'claudian-composer-expand';
const expandToggles = new WeakMap<HTMLTextAreaElement, HTMLButtonElement>();

interface TextareaMinHeightInput {
  contentHeight: number;
  flexAllocatedHeight: number;
}

export function calculateTextareaMaxHeight(viewHeight: number, expanded = false): number {
  const share = expanded ? TEXTAREA_EXPANDED_MAX_HEIGHT_PERCENT : TEXTAREA_MAX_HEIGHT_PERCENT;
  return Math.max(TEXTAREA_MIN_MAX_HEIGHT, viewHeight * share);
}

export function calculateTextareaMinHeight({
  contentHeight,
  flexAllocatedHeight,
}: TextareaMinHeightInput): number {
  return contentHeight > flexAllocatedHeight ? contentHeight : TEXTAREA_BASE_MIN_HEIGHT;
}

function isExpanded(textarea: HTMLTextAreaElement): boolean {
  return textarea.dataset.composerExpanded === 'true';
}

/**
 * Auto-resizes a textarea based on its content.
 *
 * Logic:
 * - At minimum wrapper height: let flexbox allocate space (textarea fills available)
 * - When content exceeds flex allocation: set min-height to force wrapper growth
 * - When content shrinks: remove min-height override to let wrapper shrink
 * - Max height is capped at 30% of view height (minimum 150px), 60% once the
 *   user expands an overflowing draft
 */
export function autoResizeTextarea(textarea: HTMLTextAreaElement): void {
  const viewHeight = textarea.closest('.claudian-container')?.clientHeight ?? window.innerHeight;
  const compactMaxHeight = calculateTextareaMaxHeight(viewHeight);
  let maxHeight = calculateTextareaMaxHeight(viewHeight, isExpanded(textarea));

  textarea.setCssProps({
    '--claudian-textarea-min-height': `${TEXTAREA_BASE_MIN_HEIGHT}px`,
    '--claudian-textarea-max-height': `${maxHeight}px`,
  });

  const overflowing = textarea.scrollHeight > compactMaxHeight;
  if (!overflowing && isExpanded(textarea)) {
    // A sent or trimmed draft starts compact again next time.
    delete textarea.dataset.composerExpanded;
    maxHeight = compactMaxHeight;
  }

  const flexAllocatedHeight = textarea.offsetHeight;
  const contentHeight = Math.min(textarea.scrollHeight, maxHeight);
  const minHeight = calculateTextareaMinHeight({ contentHeight, flexAllocatedHeight });

  textarea.setCssProps({
    '--claudian-textarea-min-height': `${minHeight}px`,
    '--claudian-textarea-max-height': `${maxHeight}px`,
  });

  syncExpandToggle(textarea, overflowing);
}

function syncExpandToggle(textarea: HTMLTextAreaElement, overflowing: boolean): void {
  const toggle = expandToggles.get(textarea);
  if (!toggle) return;
  toggle.classList.toggle('claudian-hidden', !overflowing);
  if (!overflowing) return;
  const expanded = isExpanded(textarea);
  toggle.textContent = formatLongTextToggle(expanded, countTextLines(textarea.value));
  toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
}

/**
 * Wires the composer's "Mehr anzeigen" toggle, which sits right below the
 * textarea. It only appears while the draft is taller than the compact cap.
 */
export function registerComposerExpandToggle(
  textarea: HTMLTextAreaElement,
  toggle: HTMLButtonElement,
): void {
  toggle.type = 'button';
  toggle.classList.add(EXPAND_TOGGLE_CLASS, 'claudian-hidden');
  expandToggles.set(textarea, toggle);

  // Keeps focus (and the caret position) in the draft while toggling.
  toggle.addEventListener('mousedown', (event) => event.preventDefault());
  toggle.addEventListener('click', (event) => {
    event.stopPropagation();
    if (isExpanded(textarea)) {
      delete textarea.dataset.composerExpanded;
    } else {
      textarea.dataset.composerExpanded = 'true';
    }
    autoResizeTextarea(textarea);
  });
}
