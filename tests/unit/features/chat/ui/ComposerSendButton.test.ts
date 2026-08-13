import { createMockEl } from '@test/helpers/mockElement';

import {
  mountComposerSendButton,
  resolveComposerSendMode,
} from '@/features/chat/ui/ComposerSendButton';

describe('resolveComposerSendMode', () => {
  it('is streaming while a turn is running', () => {
    expect(resolveComposerSendMode({ hasText: true, isStreaming: true })).toBe('streaming');
    expect(resolveComposerSendMode({ hasText: false, isStreaming: true })).toBe('streaming');
  });

  it('is ready only when the composer has text', () => {
    expect(resolveComposerSendMode({ hasText: true, isStreaming: false })).toBe('ready');
    expect(resolveComposerSendMode({ hasText: false, isStreaming: false })).toBe('idle');
  });
});

describe('mountComposerSendButton', () => {
  it('sends when ready and stops when streaming', () => {
    const parent = createMockEl();
    const input = createMockEl('textarea');
    input.value = 'Fix the tests';
    const onSend = jest.fn();
    const onStop = jest.fn();
    let streaming = false;

    const send = mountComposerSendButton(parent, {
      getInputValue: () => String(input.value),
      isStreaming: () => streaming,
      onSend,
      onStop,
    });

    expect(send.el.hasClass('is-ready')).toBe(true);
    send.el.click();
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onStop).not.toHaveBeenCalled();

    streaming = true;
    send.sync();
    expect(send.el.hasClass('is-streaming')).toBe(true);
    send.el.click();
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('does not send while idle', () => {
    const parent = createMockEl();
    const onSend = jest.fn();
    const send = mountComposerSendButton(parent, {
      getInputValue: () => '   ',
      isStreaming: () => false,
      onSend,
      onStop: jest.fn(),
    });

    expect(send.el.hasClass('is-idle')).toBe(true);
    send.el.click();
    expect(onSend).not.toHaveBeenCalled();
  });
});
