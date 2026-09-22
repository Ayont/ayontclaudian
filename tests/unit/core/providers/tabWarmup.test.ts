import '@/providers';

import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import { createPersistentRuntimeWarmupPolicy } from '@/core/providers/tabWarmup';
import type { ProviderTabWarmupContext, ProviderTabWarmupPolicy } from '@/core/providers/types';
import { AUTO_MODEL_VALUE } from '@/core/routing/modelRouterRules';
import { antigravityTabWarmupPolicy } from '@/providers/antigravity/app/AntigravityWorkspaceServices';
import { claudeTabWarmupPolicy } from '@/providers/claude/app/ClaudeWorkspaceServices';
import { clineTabWarmupPolicy } from '@/providers/cline/app/ClineWorkspaceServices';
import { codexTabWarmupPolicy } from '@/providers/codex/app/CodexWorkspaceServices';
import { dshTabWarmupPolicy } from '@/providers/dsh/app/DshWorkspaceServices';
import { grokTabWarmupPolicy } from '@/providers/grok/app/GrokWorkspaceServices';
import { kimiTabWarmupPolicy } from '@/providers/kimi/app/KimiWorkspaceServices';
import { vibeTabWarmupPolicy } from '@/providers/vibe/app/VibeWorkspaceServices';
import { zcodeTabWarmupPolicy } from '@/providers/zcode/app/ZcodeWorkspaceServices';

function createContext(overrides: {
  draftModel?: string | null;
  lifecycleState?: ProviderTabWarmupContext['tab']['lifecycleState'];
  providerId?: string;
} = {}): ProviderTabWarmupContext {
  return {
    conversation: null,
    externalContextPaths: [],
    plugin: { settings: {} } as never,
    runtime: null,
    tab: {
      conversationId: null,
      draftModel: overrides.draftModel ?? null,
      lifecycleState: overrides.lifecycleState ?? 'blank',
      providerId: overrides.providerId ?? 'codex',
    },
  };
}

describe('createPersistentRuntimeWarmupPolicy', () => {
  it('warms the runtime so the CLI cold start is off the first-response path', () => {
    const policy = createPersistentRuntimeWarmupPolicy('codex');

    expect(policy.resolveMode(createContext())).toBe('runtime');
  });

  it('warms a bound tab regardless of its draft model', () => {
    const policy = createPersistentRuntimeWarmupPolicy('codex');

    expect(policy.resolveMode(createContext({
      draftModel: 'some-other-provider-model',
      lifecycleState: 'bound_cold',
    }))).toBe('runtime');
  });

  it('skips a blank tab whose draft model belongs to another provider', () => {
    jest.spyOn(ProviderRegistry, 'resolveProviderForModel').mockReturnValue('claude');
    const policy = createPersistentRuntimeWarmupPolicy('codex');

    expect(policy.resolveMode(createContext({ draftModel: 'claude-opus-5' }))).toBe('none');
  });

  it('still warms a blank tab whose draft model is its own', () => {
    jest.spyOn(ProviderRegistry, 'resolveProviderForModel').mockReturnValue('codex');
    const policy = createPersistentRuntimeWarmupPolicy('codex');

    expect(policy.resolveMode(createContext({ draftModel: 'gpt-5.2' }))).toBe('runtime');
  });

  it('treats the auto model as no provider commitment and warms anyway', () => {
    const resolve = jest.spyOn(ProviderRegistry, 'resolveProviderForModel');
    const policy = createPersistentRuntimeWarmupPolicy('codex');

    expect(policy.resolveMode(createContext({ draftModel: AUTO_MODEL_VALUE }))).toBe('runtime');
    expect(resolve).not.toHaveBeenCalled();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });
});

describe('persistent-runtime providers', () => {
  // Workspace services are built asynchronously at runtime, so the registry is
  // empty in unit tests. Assert on the exported policies instead — that is what
  // the services objects hand to the registry.
  const POLICIES: Array<[string, ProviderTabWarmupPolicy]> = [
    ['antigravity', antigravityTabWarmupPolicy],
    ['claude', claudeTabWarmupPolicy],
    ['cline', clineTabWarmupPolicy],
    ['codex', codexTabWarmupPolicy],
    ['dsh', dshTabWarmupPolicy],
    ['grok', grokTabWarmupPolicy],
    ['kimi', kimiTabWarmupPolicy],
    ['vibe', vibeTabWarmupPolicy],
    ['zcode', zcodeTabWarmupPolicy],
  ];

  it.each(POLICIES)('%s warms its runtime at tab open', (providerId, policy) => {
    expect(policy.resolveMode(createContext({ providerId }))).toBe('runtime');
  });

  it.each(POLICIES)('%s stays cold for a blank tab drafting another provider', (providerId, policy) => {
    jest.spyOn(ProviderRegistry, 'resolveProviderForModel').mockReturnValue('some-other-provider');

    expect(policy.resolveMode(createContext({ draftModel: 'foreign-model', providerId })))
      .toBe('none');
  });
});
