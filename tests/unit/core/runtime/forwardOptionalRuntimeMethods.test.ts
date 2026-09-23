import { withGoalLoop } from '@/core/conversation/goalLoopRuntime';
import { withProviderPromptDelivery } from '@/core/providers/providerPromptDelivery';
import type { ChatRuntime } from '@/core/runtime/ChatRuntime';
import {
  forwardOptionalRuntimeMethods,
  OPTIONAL_RUNTIME_METHODS,
} from '@/core/runtime/forwardOptionalRuntimeMethods';

function baseWithEveryOptionalMethod(): { base: ChatRuntime; receivers: Map<string, unknown> } {
  const receivers = new Map<string, unknown>();
  const base = { providerId: 'codex' } as unknown as ChatRuntime;
  for (const name of OPTIONAL_RUNTIME_METHODS) {
    (base as unknown as Record<string, unknown>)[name] = function (this: unknown) {
      receivers.set(name, this);
      return name;
    };
  }
  return { base, receivers };
}

describe('forwardOptionalRuntimeMethods', () => {
  it('forwards each optional method bound to the base runtime', () => {
    const { base, receivers } = baseWithEveryOptionalMethod();
    const wrapped = {} as ChatRuntime;

    forwardOptionalRuntimeMethods(base, wrapped);

    for (const name of OPTIONAL_RUNTIME_METHODS) {
      expect((wrapped as unknown as Record<string, () => unknown>)[name]()).toBe(name);
      expect(receivers.get(name)).toBe(base);
    }
  });

  it('leaves methods the base does not implement absent', () => {
    const wrapped = {} as ChatRuntime;

    forwardOptionalRuntimeMethods({ providerId: 'grok' } as unknown as ChatRuntime, wrapped);

    expect(wrapped.pauseNativeGoal).toBeUndefined();
    expect(wrapped.cancelSubagent).toBeUndefined();
  });

  it.each([
    ['goal loop', (base: ChatRuntime) => withGoalLoop(base, { isPaused: () => false })],
    ['prompt delivery', (base: ChatRuntime) => withProviderPromptDelivery(base, { policy: 'session-preamble', plugin: {} } as never)],
  ])('the %s wrapper passes every optional method through', (_label, wrap) => {
    const { base } = baseWithEveryOptionalMethod();

    const wrapped = wrap(base);

    for (const name of OPTIONAL_RUNTIME_METHODS) {
      expect(typeof (wrapped as unknown as Record<string, unknown>)[name]).toBe('function');
    }
  });
});
