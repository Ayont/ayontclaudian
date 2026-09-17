import { AUTO_MODEL_VALUE } from '../routing/modelRouterRules';
import { ProviderRegistry } from './ProviderRegistry';
import type { ProviderId, ProviderTabWarmupPolicy } from './types';

/**
 * Standard warmup for a provider that keeps a persistent runtime.
 *
 * Bringing the runtime up when a tab is opened or switched to — instead of on
 * the first send — moves the CLI cold start OFF the first-response path. That
 * cost is multiple seconds for the providers that actually spawn a process
 * (Codex boots its app-server in `ensureReady`), and for the print-mode CLIs it
 * still pays for itself: the PATH scan happens while the user is typing, and a
 * missing binary surfaces as "not ready" instead of as a failed first turn.
 *
 * `ensureReady()` is idempotent, so repeat warmups are no-ops, and the tab
 * manager only warms the active tab.
 *
 * Guard: a BLANK tab whose draft model belongs to a different provider is left
 * cold — spawning Codex for a Kimi draft would be wasted work. A bound tab has
 * already committed to its provider, and `__auto__` commits to none, so both
 * warm unconditionally.
 */
export function createPersistentRuntimeWarmupPolicy(
  providerId: ProviderId,
): ProviderTabWarmupPolicy {
  return {
    resolveMode(context) {
      const { draftModel, lifecycleState } = context.tab;
      if (lifecycleState === 'blank' && draftModel && draftModel !== AUTO_MODEL_VALUE) {
        const draftProvider = ProviderRegistry.resolveProviderForModel(
          draftModel,
          context.plugin.settings as unknown as Record<string, unknown>,
        );
        if (draftProvider !== providerId) {
          return 'none';
        }
      }
      return 'runtime';
    },
  };
}
