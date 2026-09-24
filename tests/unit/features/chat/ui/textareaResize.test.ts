/**
 * @jest-environment jsdom
 */

import {
  autoResizeTextarea,
  calculateTextareaMaxHeight,
  calculateTextareaMinHeight,
  registerComposerExpandToggle,
  TEXTAREA_BASE_MIN_HEIGHT,
  TEXTAREA_EXPANDED_MAX_HEIGHT_PERCENT,
  TEXTAREA_MAX_HEIGHT_PERCENT,
  TEXTAREA_MIN_MAX_HEIGHT,
} from '@/features/chat/ui/textareaResize';
import { setLocale } from '@/i18n/i18n';

describe('textareaResize', () => {
  it('returns the base height when content exactly matches base flex allocation', () => {
    expect(calculateTextareaMinHeight({
      contentHeight: 102,
      flexAllocatedHeight: 102,
    })).toBe(TEXTAREA_BASE_MIN_HEIGHT);
  });

  it('uses the content height when content exceeds flex allocation', () => {
    expect(calculateTextareaMinHeight({
      contentHeight: 128,
      flexAllocatedHeight: 102,
    })).toBe(128);
  });

  it('returns the base height when content fits inside flex allocation', () => {
    expect(calculateTextareaMinHeight({
      contentHeight: 80,
      flexAllocatedHeight: 102,
    })).toBe(TEXTAREA_BASE_MIN_HEIGHT);
  });

  it('measures from base height so previously grown content can shrink', () => {
    const textarea = createResizeTextarea({
      baseOffsetHeight: 102,
      grownOffsetHeight: 116,
      baseScrollHeight: 102,
      grownScrollHeight: 116,
    });

    textarea.style.setProperty('--claudian-textarea-min-height', '116px');

    autoResizeTextarea(textarea);

    expect(textarea.style.getPropertyValue('--claudian-textarea-min-height')).toBe('60px');
  });

  it('measures from base height so long content does not bounce', () => {
    const textarea = createResizeTextarea({
      baseOffsetHeight: 102,
      grownOffsetHeight: 116,
      baseScrollHeight: 116,
      grownScrollHeight: 116,
    });

    textarea.style.setProperty('--claudian-textarea-min-height', '116px');

    autoResizeTextarea(textarea);

    expect(textarea.style.getPropertyValue('--claudian-textarea-min-height')).toBe('116px');
  });

  it('caps max height by viewport percentage with a minimum usable cap', () => {
    expect(calculateTextareaMaxHeight(100)).toBe(TEXTAREA_MIN_MAX_HEIGHT);
    expect(calculateTextareaMaxHeight(1000)).toBe(1000 * TEXTAREA_MAX_HEIGHT_PERCENT);
  });

  it('keeps most of the chat visible while collapsed and allows more once expanded', () => {
    expect(TEXTAREA_MAX_HEIGHT_PERCENT).toBeLessThanOrEqual(0.35);
    expect(calculateTextareaMaxHeight(1000, true)).toBe(1000 * TEXTAREA_EXPANDED_MAX_HEIGHT_PERCENT);
    expect(TEXTAREA_EXPANDED_MAX_HEIGHT_PERCENT).toBeGreaterThan(TEXTAREA_MAX_HEIGHT_PERCENT);
  });
});

describe('composer expand toggle', () => {
  beforeEach(() => {
    setLocale('de');
  });

  function mountComposer(contentHeight: () => number) {
    const wrapper = document.createElement('div');
    const textarea = document.createElement('textarea');
    wrapper.appendChild(textarea);
    textarea.setCssProps = (props: Record<string, string>) => {
      Object.entries(props).forEach(([key, value]) => textarea.style.setProperty(key, value));
    };
    Object.defineProperty(textarea, 'offsetHeight', { get: () => 60 });
    Object.defineProperty(textarea, 'scrollHeight', { get: contentHeight });
    const toggle = document.createElement('button');
    wrapper.appendChild(toggle);
    registerComposerExpandToggle(textarea, toggle);
    const maxHeight = () => parseFloat(textarea.style.getPropertyValue('--claudian-textarea-max-height'));
    return { wrapper, textarea, toggle, maxHeight };
  }

  it('stays hidden while the draft fits', () => {
    const { textarea, toggle } = mountComposer(() => 80);
    textarea.value = 'kurz';

    autoResizeTextarea(textarea);

    expect(toggle.classList.contains('claudian-hidden')).toBe(true);
  });

  it('offers "Mehr anzeigen" with the line count once a paste overflows the cap', () => {
    const { textarea, toggle } = mountComposer(() => 2000);
    textarea.value = Array.from({ length: 48 }, (_, i) => `Zeile ${i}`).join('\n');

    autoResizeTextarea(textarea);

    expect(toggle.classList.contains('claudian-hidden')).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.textContent).toContain('Mehr anzeigen');
    expect(toggle.textContent).toContain('48 Zeilen');
  });

  it('raises the cap on click and lowers it again', () => {
    const { textarea, toggle, maxHeight } = mountComposer(() => 2000);
    textarea.value = 'x\n'.repeat(60);
    autoResizeTextarea(textarea);
    const collapsed = maxHeight();

    toggle.click();
    expect(maxHeight()).toBeGreaterThan(collapsed);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.textContent).toContain('Weniger anzeigen');

    toggle.click();
    expect(maxHeight()).toBe(collapsed);
  });

  it('falls back to the compact cap after the draft is sent', () => {
    let height = 2000;
    const { textarea, toggle, maxHeight } = mountComposer(() => height);
    textarea.value = 'x\n'.repeat(60);
    autoResizeTextarea(textarea);
    const collapsed = maxHeight();
    toggle.click();

    textarea.value = '';
    height = 60;
    autoResizeTextarea(textarea);

    expect(toggle.classList.contains('claudian-hidden')).toBe(true);
    expect(maxHeight()).toBe(collapsed);
  });
});

function createResizeTextarea({
  baseOffsetHeight,
  grownOffsetHeight,
  baseScrollHeight,
  grownScrollHeight,
}: {
  baseOffsetHeight: number;
  grownOffsetHeight: number;
  baseScrollHeight: number;
  grownScrollHeight: number;
}): HTMLTextAreaElement {
  const textarea = document.createElement('textarea');

  textarea.setCssProps = (props: Record<string, string>) => {
    Object.entries(props).forEach(([key, value]) => {
      textarea.style.setProperty(key, value);
    });
  };

  const isBaseHeight = () =>
    textarea.style.getPropertyValue('--claudian-textarea-min-height') === `${TEXTAREA_BASE_MIN_HEIGHT}px`;

  Object.defineProperty(textarea, 'offsetHeight', {
    get: () => (isBaseHeight() ? baseOffsetHeight : grownOffsetHeight),
  });
  Object.defineProperty(textarea, 'scrollHeight', {
    get: () => (isBaseHeight() ? baseScrollHeight : grownScrollHeight),
  });

  return textarea;
}
