import { setIcon } from 'obsidian';

import { collapseElement, setupCollapsible } from './collapsible';

export type RenderContentFn = (el: HTMLElement, markdown: string) => Promise<void>;

const TIMER_TICK_MS = 1000;
const THINKING_ICON = 'brain';
const CHEVRON_ICON = 'chevron-right';
const BASE_ARIA_LABEL = 'Extended thinking';

export interface ThinkingBlockState {
  wrapperEl: HTMLElement;
  contentEl: HTMLElement;
  labelEl: HTMLElement;
  content: string;
  startTime: number;
  timerInterval: number | null;
  isExpanded: boolean;
}

/**
 * Build the header row: leading "thinking" glyph, label, and a trailing
 * chevron that rotates via CSS when the block expands. The header is always
 * the first child of the wrapper so collapsible wiring can target it.
 */
function buildHeader(wrapperEl: HTMLElement): { header: HTMLElement; labelEl: HTMLElement } {
  const header = wrapperEl.createDiv({ cls: 'claudian-thinking-header' });
  header.setAttribute('tabindex', '0');
  header.setAttribute('role', 'button');
  header.setAttribute('aria-expanded', 'false');

  const iconEl = header.createSpan({ cls: 'claudian-thinking-icon' });
  setIcon(iconEl, THINKING_ICON);
  iconEl.setAttribute('aria-hidden', 'true');

  const labelEl = header.createSpan({ cls: 'claudian-thinking-label' });

  const chevronEl = header.createSpan({ cls: 'claudian-thinking-chevron' });
  setIcon(chevronEl, CHEVRON_ICON);
  chevronEl.setAttribute('aria-hidden', 'true');

  return { header, labelEl };
}

export function createThinkingBlock(
  parentEl: HTMLElement,
  _renderContent: RenderContentFn
): ThinkingBlockState {
  const wrapperEl = parentEl.createDiv({ cls: 'claudian-thinking-block' });
  wrapperEl.addClass('claudian-thinking-block--streaming');

  const { header, labelEl } = buildHeader(wrapperEl);

  const startTime = Date.now();
  labelEl.setText('Thinking 0s...');

  // Update the label once per second while reasoning streams in.
  const timerInterval = window.setInterval(() => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    labelEl.setText(`Thinking ${elapsed}s...`);
  }, TIMER_TICK_MS);

  // Collapsible content (collapsed by default)
  const contentEl = wrapperEl.createDiv({ cls: 'claudian-thinking-content' });

  // Create state object first so toggle can reference it
  const state: ThinkingBlockState = {
    wrapperEl,
    contentEl,
    labelEl,
    content: '',
    startTime,
    timerInterval,
    isExpanded: false,
  };

  // Setup collapsible behavior (handles click, keyboard, ARIA, CSS)
  setupCollapsible(wrapperEl, header, contentEl, state, { baseAriaLabel: BASE_ARIA_LABEL });

  return state;
}

export async function appendThinkingContent(
  state: ThinkingBlockState,
  content: string,
  renderContent: RenderContentFn
) {
  state.content += content;
  await renderContent(state.contentEl, state.content);
}

export function finalizeThinkingBlock(state: ThinkingBlockState): number {
  // Stop the timer
  if (state.timerInterval) {
    window.clearInterval(state.timerInterval);
    state.timerInterval = null;
  }

  // Stop the live pulse now that reasoning has settled.
  state.wrapperEl.removeClass('claudian-thinking-block--streaming');

  // Calculate final duration
  const durationSeconds = Math.floor((Date.now() - state.startTime) / 1000);

  // Update label to show final duration (without "...")
  state.labelEl.setText(`Thought for ${durationSeconds}s`);

  // Collapse when done and sync state
  const header = state.wrapperEl.querySelector('.claudian-thinking-header');
  if (header) {
    collapseElement(state.wrapperEl, header as HTMLElement, state.contentEl, state);
  }

  return durationSeconds;
}

export function cleanupThinkingBlock(state: ThinkingBlockState | null) {
  if (state?.timerInterval) {
    window.clearInterval(state.timerInterval);
  }
}

export function renderStoredThinkingBlock(
  parentEl: HTMLElement,
  content: string,
  durationSeconds: number | undefined,
  renderContent: RenderContentFn
): HTMLElement {
  const wrapperEl = parentEl.createDiv({ cls: 'claudian-thinking-block' });

  const { header, labelEl } = buildHeader(wrapperEl);

  const labelText = durationSeconds !== undefined ? `Thought for ${durationSeconds}s` : 'Thought';
  labelEl.setText(labelText);

  // Collapsible content
  const contentEl = wrapperEl.createDiv({ cls: 'claudian-thinking-content' });
  void renderContent(contentEl, content).catch(() => {
    contentEl.setText(content);
  });

  // Setup collapsible behavior (handles click, keyboard, ARIA, CSS)
  const state = { isExpanded: false };
  setupCollapsible(wrapperEl, header, contentEl, state, { baseAriaLabel: BASE_ARIA_LABEL });

  return wrapperEl;
}
