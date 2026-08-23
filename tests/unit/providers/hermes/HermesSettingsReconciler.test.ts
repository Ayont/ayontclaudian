import type { Conversation } from '@/core/types';
import { hermesSettingsReconciler } from '@/providers/hermes/env/HermesSettingsReconciler';
import { getHermesProviderSettings } from '@/providers/hermes/settings';

const OPUS = 'openrouter:anthropic/claude-opus-5';

function createConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conv-1',
    messages: [],
    providerId: 'hermes',
    providerState: { sessionId: 'sess-1', statePath: '/home/a/.hermes/state.db' },
    sessionId: 'sess-1',
    ...overrides,
  } as Conversation;
}

describe('reconcileModelWithEnvironment', () => {
  it('invalidates Hermes sessions when HERMES_HOME changes', () => {
    const settings: Record<string, unknown> = {
      providerConfigs: { hermes: { environmentVariables: 'HERMES_HOME=/srv/hermes-work' } },
    };
    const conversation = createConversation();

    const result = hermesSettingsReconciler.reconcileModelWithEnvironment(settings, [conversation]);

    expect(result.changed).toBe(true);
    expect(result.invalidatedConversations).toEqual([conversation]);
    expect(conversation.sessionId).toBeNull();
    expect(conversation.providerState).toBeUndefined();
    expect(getHermesProviderSettings(settings).environmentHash).toBe('HERMES_HOME=/srv/hermes-work');
  });

  it('is a no-op on the second pass with the same environment', () => {
    const settings: Record<string, unknown> = {
      providerConfigs: { hermes: { environmentVariables: 'HERMES_PROFILE=work' } },
    };
    hermesSettingsReconciler.reconcileModelWithEnvironment(settings, []);

    expect(hermesSettingsReconciler.reconcileModelWithEnvironment(settings, [])).toEqual({
      changed: false,
      invalidatedConversations: [],
    });
  });

  it('ignores variables that do not relocate the Hermes home', () => {
    const settings: Record<string, unknown> = {
      providerConfigs: { hermes: { environmentVariables: 'HERMES_REDACT_SECRETS=1' } },
    };

    const result = hermesSettingsReconciler.reconcileModelWithEnvironment(settings, []);

    expect(getHermesProviderSettings(settings).environmentHash).toBe('');
    expect(result.changed).toBe(false);
  });

  it('leaves other providers\' conversations untouched', () => {
    const settings: Record<string, unknown> = {
      providerConfigs: { hermes: { environmentVariables: 'HERMES_HOME=/srv/hermes-work' } },
    };
    const foreign = createConversation({ id: 'conv-2', providerId: 'opencode' });

    const result = hermesSettingsReconciler.reconcileModelWithEnvironment(settings, [foreign]);

    expect(result.invalidatedConversations).toEqual([]);
    expect(foreign.sessionId).toBe('sess-1');
  });
});

describe('normalizeModelVariantSettings', () => {
  it('reports no change for already-canonical settings', () => {
    const settings: Record<string, unknown> = {
      model: `hermes:${OPUS}`,
      providerConfigs: { hermes: { selectedMode: 'default', visibleModels: [OPUS] } },
    };

    expect(hermesSettingsReconciler.normalizeModelVariantSettings(settings)).toBe(false);
  });

  it('repairs a mode Hermes never offered', () => {
    const settings: Record<string, unknown> = {
      providerConfigs: { hermes: { selectedMode: 'plan' } },
    };

    expect(hermesSettingsReconciler.normalizeModelVariantSettings(settings)).toBe(true);
    expect(getHermesProviderSettings(settings).selectedMode).toBe('default');
  });

  it('deduplicates the visible model list', () => {
    const settings: Record<string, unknown> = {
      providerConfigs: { hermes: { visibleModels: [OPUS, OPUS] } },
    };

    expect(hermesSettingsReconciler.normalizeModelVariantSettings(settings)).toBe(true);
    expect(getHermesProviderSettings(settings).visibleModels).toEqual([OPUS]);
  });
});

describe('handleEnvironmentChange', () => {
  it('drops the cached catalog so it is re-read from the new Hermes home', () => {
    const settings: Record<string, unknown> = { providerConfigs: { hermes: {} } };
    expect(hermesSettingsReconciler.handleEnvironmentChange?.(settings)).toBe(false);
  });
});
