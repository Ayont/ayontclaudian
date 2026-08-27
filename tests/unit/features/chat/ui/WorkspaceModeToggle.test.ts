import { createMockEl, type MockElement } from '@test/helpers/mockElement';

import { WorkspaceModeToggle } from '@/features/chat/ui/WorkspaceModeToggle';

describe('WorkspaceModeToggle', () => {
  function createToggle() {
    const parent = createMockEl();
    const onConfigureModel = jest.fn();
    const toggle = new WorkspaceModeToggle(parent as HTMLElement, {
      getMode: () => 'code',
      onModeChange: jest.fn().mockResolvedValue(undefined),
      onConfigureModel,
    });
    const segments = parent.querySelectorAll('.claudian-mode-toggle-segment') as MockElement[];
    return { onConfigureModel, parent, segments, toggle };
  }

  it('renders native pressed buttons for both workspace modes', () => {
    const { parent, segments } = createToggle();

    expect(parent.querySelector('.claudian-mode-toggle')?.getAttribute('aria-label'))
      .toBe('Arbeitsmodus');
    expect(segments).toHaveLength(2);
    expect(segments.every((segment) => segment.tagName === 'BUTTON')).toBe(true);
    expect(segments.every((segment) => segment.getAttribute('type') === 'button')).toBe(true);
    expect(segments[0].getAttribute('aria-pressed')).toBe('true');
    expect(segments[1].getAttribute('aria-pressed')).toBe('false');
  });

  it.each([
    { key: 'F10', shiftKey: true },
    { key: 'ContextMenu', shiftKey: false },
  ])('opens model configuration from $key', ({ key, shiftKey }) => {
    const { onConfigureModel, segments } = createToggle();
    const preventDefault = jest.fn();
    const stopPropagation = jest.fn();

    segments[0].dispatchEvent({
      type: 'keydown',
      key,
      shiftKey,
      preventDefault,
      stopPropagation,
    });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(stopPropagation).toHaveBeenCalledTimes(1);
    expect(onConfigureModel).toHaveBeenCalledWith('code', segments[0]);
    expect(segments[0].getAttribute('aria-keyshortcuts')).toBe('Shift+F10');
  });
});
