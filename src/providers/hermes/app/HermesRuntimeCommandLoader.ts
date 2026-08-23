import type {
  ProviderRuntimeCommandLoader,
  ProviderRuntimeCommandLoaderContext,
} from '../../../core/providers/types';
import { HermesChatRuntime } from '../runtime/HermesChatRuntime';
import { getHermesProviderSettings, HERMES_PROVIDER_ID } from '../settings';

export class HermesRuntimeCommandLoader implements ProviderRuntimeCommandLoader {
  isAvailable(settings: Record<string, unknown>): boolean {
    return getHermesProviderSettings(settings).enabled;
  }

  async loadCommands(context: ProviderRuntimeCommandLoaderContext) {
    const shouldWarmBlankSession = context.allowSessionCreation === true
      && !context.conversation?.sessionId;
    const shouldWarmPreSessionConversation = !!context.conversation
      && !context.conversation.sessionId
      && context.conversation.messages.length > 0;

    if (
      !context.runtime
      && !context.conversation?.sessionId
      && !shouldWarmBlankSession
      && !shouldWarmPreSessionConversation
    ) {
      return [];
    }

    // Warming a history-backed conversation on the bound runtime would create
    // its real session early and let the first turn skip history bootstrap;
    // that case gets an isolated runtime instead.
    const canReuseRuntime = context.runtime?.providerId === HERMES_PROVIDER_ID
      && !shouldWarmPreSessionConversation;
    const runtime = canReuseRuntime
      ? context.runtime!
      : new HermesChatRuntime(context.plugin);

    try {
      if (context.conversation) {
        runtime.syncConversationState(context.conversation, context.externalContextPaths);
      }

      const ready = await runtime.ensureReady({
        allowSessionCreation: shouldWarmBlankSession || shouldWarmPreSessionConversation,
      });
      if (!ready) {
        return [];
      }

      return await runtime.getSupportedCommands();
    } finally {
      if (runtime !== context.runtime) {
        runtime.cleanup();
      }
    }
  }
}
