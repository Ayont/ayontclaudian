import { setIcon } from 'obsidian';

export type ComposerSendMode = 'idle' | 'ready' | 'streaming';

export function resolveComposerSendMode(options: {
  hasText: boolean;
  isStreaming: boolean;
}): ComposerSendMode {
  if (options.isStreaming) {
    return 'streaming';
  }
  return options.hasText ? 'ready' : 'idle';
}

export interface ComposerSendButtonHandle {
  el: HTMLElement;
  sync: () => void;
  destroy: () => void;
}

export interface ComposerSendButtonOptions {
  getInputValue: () => string;
  isStreaming: () => boolean;
  onSend: () => void;
  onStop: () => void;
}

const MODE_CLASS: Record<ComposerSendMode, string> = {
  idle: 'is-idle',
  ready: 'is-ready',
  streaming: 'is-streaming',
};

export function mountComposerSendButton(
  parent: HTMLElement,
  options: ComposerSendButtonOptions,
): ComposerSendButtonHandle {
  const el = parent.createEl('button', {
    cls: 'claudian-send-btn is-idle',
    attr: { type: 'button', 'aria-label': 'Senden' },
  });
  const iconEl = el.createSpan({ cls: 'claudian-send-btn-icon' });

  const sync = (): void => {
    const mode = resolveComposerSendMode({
      hasText: options.getInputValue().trim().length > 0,
      isStreaming: options.isStreaming(),
    });
    for (const cls of ['is-idle', 'is-ready', 'is-streaming']) {
      el.classList.remove(cls);
    }
    el.classList.add(MODE_CLASS[mode]);
    if (mode === 'idle') {
      el.setAttribute('disabled', 'true');
    } else {
      el.removeAttribute('disabled');
    }
    el.setAttribute(
      'aria-label',
      mode === 'streaming' ? 'Antwort stoppen' : 'Senden',
    );
    setIcon(iconEl, mode === 'streaming' ? 'square' : 'arrow-up');
  };

  const onClick = (): void => {
    const mode = resolveComposerSendMode({
      hasText: options.getInputValue().trim().length > 0,
      isStreaming: options.isStreaming(),
    });
    if (mode === 'streaming') {
      options.onStop();
      return;
    }
    if (mode === 'ready') {
      options.onSend();
    }
  };

  el.addEventListener('click', onClick);
  sync();

  return {
    el,
    sync,
    destroy: () => el.removeEventListener('click', onClick),
  };
}
