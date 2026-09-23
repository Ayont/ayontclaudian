import { Notice } from 'obsidian';

import { showActionNotice } from '@/shared/components/actionNotice';

const MockNotice = Notice as unknown as jest.Mock;

type FakeElement = {
  tagName: string;
  className: string;
  textContent: string;
  listeners: Map<string, () => void>;
  addEventListener: (type: string, listener: () => void) => void;
};

function fakeDocument() {
  const created: FakeElement[] = [];
  const createElement = (tagName: string): FakeElement => {
    const element: FakeElement = {
      tagName,
      className: '',
      textContent: '',
      listeners: new Map(),
      addEventListener(type, listener) { element.listeners.set(type, listener); },
    };
    created.push(element);
    return element;
  };
  const fragment = { children: [] as FakeElement[], append(...nodes: FakeElement[]) { fragment.children.push(...nodes); } };
  return { created, doc: { createElement, createDocumentFragment: () => fragment }, fragment };
}

describe('showActionNotice', () => {
  const globals = globalThis as { activeDocument?: unknown };

  beforeEach(() => {
    MockNotice.mockClear();
    MockNotice.mockImplementation(function (this: { hide: jest.Mock }) { this.hide = jest.fn(); });
  });

  afterEach(() => {
    delete globals.activeDocument;
    MockNotice.mockImplementation(() => {});
  });

  it('shows the message with an action button that runs once and closes the notice', () => {
    const { doc, created, fragment } = fakeDocument();
    globals.activeDocument = doc;
    const onAction = jest.fn();

    showActionNotice('„Firewall“ gelöscht.', 'Rückgängig', onAction, 8_000);

    expect(MockNotice).toHaveBeenCalledWith(fragment, 8_000);
    const button = created.find((el) => el.tagName === 'button')!;
    expect(button.textContent).toBe('Rückgängig');
    button.listeners.get('click')!();
    button.listeners.get('click')!();
    expect(onAction).toHaveBeenCalledTimes(1);
    expect((MockNotice.mock.instances[0] as { hide: jest.Mock }).hide).toHaveBeenCalled();
  });

  it('falls back to a plain notice where no document exists', () => {
    showActionNotice('„Firewall“ gelöscht.', 'Rückgängig', jest.fn());

    expect(MockNotice).toHaveBeenCalledWith('„Firewall“ gelöscht.', 10_000);
  });
});
