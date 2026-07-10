import { createMockEl } from '@test/helpers/mockElement';

import { ChatSearchController } from '@/features/chat/ui/ChatSearch';

function createController() {
  const hostEl = createMockEl();
  const messagesEl = createMockEl();
  const controller = new ChatSearchController(hostEl as any, messagesEl as any);
  const containerEl = hostEl.children[0];
  return { controller, hostEl, messagesEl, containerEl };
}

describe('ChatSearchController', () => {
  it('renders a hidden search bar into the host element', () => {
    const { hostEl, containerEl } = createController();

    expect(hostEl.children).toHaveLength(1);
    expect(containerEl.hasClass('claudian-chat-search')).toBe(true);
    expect(containerEl.hasClass('claudian-hidden')).toBe(true);
  });

  it('open() reveals the bar, close() hides it again', () => {
    const { controller, containerEl } = createController();

    controller.open();
    expect(controller.isVisible()).toBe(true);
    expect(containerEl.hasClass('claudian-hidden')).toBe(false);

    controller.close();
    expect(controller.isVisible()).toBe(false);
    expect(containerEl.hasClass('claudian-hidden')).toBe(true);
  });

  it('toggle() flips visibility', () => {
    const { controller } = createController();

    controller.toggle();
    expect(controller.isVisible()).toBe(true);
    controller.toggle();
    expect(controller.isVisible()).toBe(false);
  });

  it('Escape in the input closes the bar', () => {
    const { controller, containerEl } = createController();
    controller.open();

    const inputEl = containerEl.children.find(
      (child: any) => child.hasClass('claudian-chat-search-input'),
    );
    inputEl!.dispatchEvent({
      type: 'keydown',
      key: 'Escape',
      preventDefault: jest.fn(),
      stopPropagation: jest.fn(),
    });

    expect(controller.isVisible()).toBe(false);
  });

  it('shows "0" when a query has no matches (no tree walker in test env)', () => {
    jest.useFakeTimers();
    try {
      const { controller, containerEl } = createController();
      controller.open();

      const inputEl = containerEl.children.find(
        (child: any) => child.hasClass('claudian-chat-search-input'),
      )!;
      inputEl.value = 'nirgends';
      inputEl.dispatchEvent({ type: 'input' });
      jest.advanceTimersByTime(200);

      const countEl = containerEl.children.find(
        (child: any) => child.hasClass('claudian-chat-search-count'),
      )!;
      expect(countEl.textContent).toBe('0');
      expect(containerEl.hasClass('has-matches')).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it('destroy() removes the bar element and closes the search', () => {
    const { controller, containerEl } = createController();
    const removeSpy = jest.spyOn(containerEl, 'remove');
    controller.open();

    controller.destroy();

    expect(controller.isVisible()).toBe(false);
    expect(removeSpy).toHaveBeenCalled();
  });
});
