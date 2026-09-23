import type { ProviderCompactSupport } from '@/core/providers/types';
import type { UsageInfo } from '@/core/types';
import {
  ContextPressureController,
  type ContextPressureControllerDeps,
} from '@/features/chat/controllers/ContextPressureController';
import type { ContextPressureViewState } from '@/features/chat/ui/ContextPressureBanner';

let conversationSeq = 0;

function usageAt(percentage: number, overrides: Partial<UsageInfo> = {}): UsageInfo {
  return {
    inputTokens: 0,
    contextWindow: 200_000,
    contextTokens: Math.round(2_000 * percentage),
    percentage,
    ...overrides,
  };
}

function setup(overrides: Partial<ContextPressureControllerDeps> & {
  usage?: UsageInfo | null;
  providerId?: string;
  compact?: Readonly<ProviderCompactSupport>;
  streaming?: boolean;
  conversationId?: string | null;
} = {}) {
  const rendered: Array<ContextPressureViewState | null> = [];
  const env = {
    usage: overrides.usage === undefined ? usageAt(85) : overrides.usage,
    providerId: overrides.providerId ?? 'claude',
    compact: 'compact' in overrides ? overrides.compact : { command: '/compact', availability: 'builtin' } as const,
    streaming: overrides.streaming ?? false,
    conversationId: overrides.conversationId === undefined ? `conv-${++conversationSeq}` : overrides.conversationId,
  };
  const deps: ContextPressureControllerDeps = {
    view: { render: (state) => { rendered.push(state); } },
    getProviderId: () => env.providerId,
    getCompactSupport: () => env.compact,
    getUsage: () => env.usage,
    isStreaming: () => env.streaming,
    getConversationId: () => env.conversationId,
    loadAdvertisedCommands: jest.fn().mockResolvedValue(null),
    onCompactCommandChange: jest.fn(),
    sendCompact: jest.fn().mockResolvedValue(undefined),
    continueWithLessContext: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  const controller = new ContextPressureController(deps);
  const last = () => rendered[rendered.length - 1];
  return { controller, deps, env, rendered, last };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('ContextPressureController', () => {
  it('stays hidden below the high threshold and without usage', () => {
    const { controller, env, last } = setup({ usage: usageAt(60) });
    controller.refresh();
    expect(last()).toBeNull();
    env.usage = null;
    controller.refresh();
    expect(last()).toBeNull();
  });

  it('renders the level, usage and a builtin compact command', () => {
    const { controller, deps, last } = setup({ usage: usageAt(85) });
    controller.refresh();
    expect(last()).toEqual({
      level: 'high',
      percentage: 85,
      contextTokens: 170_000,
      contextWindow: 200_000,
      approximate: false,
      compactCommand: '/compact',
      streaming: false,
      condensing: false,
    });
    expect(deps.onCompactCommandChange).toHaveBeenCalledWith('/compact');
  });

  it('switches to the critical level and flags estimated usage', () => {
    const { controller, last } = setup({ usage: usageAt(95, { contextWindowIsAuthoritative: false }) });
    controller.refresh();
    expect(last()?.level).toBe('critical');
    expect(last()?.approximate).toBe(true);
  });

  it.each(['grok-bot', 'perplexity-chat'])('never warns for the desktop relay %s', (providerId) => {
    const { controller, last } = setup({ providerId, usage: usageAt(97) });
    controller.refresh();
    expect(last()).toBeNull();
  });

  it('offers no compact action for a provider without manual compaction', () => {
    const { controller, deps, last } = setup({ compact: undefined });
    controller.refresh();
    expect(last()?.compactCommand).toBeNull();
    expect(deps.loadAdvertisedCommands).not.toHaveBeenCalled();
  });

  it('offers an advertised command only once the agent has listed it', async () => {
    const loadAdvertisedCommands = jest.fn().mockResolvedValue([{ name: 'help' }, { name: 'compress' }]);
    const { controller, deps, last } = setup({
      compact: { command: '/compress', availability: 'advertised' },
      loadAdvertisedCommands,
    });

    controller.refresh();
    expect(last()?.compactCommand).toBeNull();
    await flush();

    expect(loadAdvertisedCommands).toHaveBeenCalledTimes(1);
    expect(last()?.compactCommand).toBe('/compress');
    expect(deps.onCompactCommandChange).toHaveBeenLastCalledWith('/compress');

    controller.refresh();
    await flush();
    expect(loadAdvertisedCommands).toHaveBeenCalledTimes(1);
  });

  it('does not ask the runtime for advertised commands while pressure is normal', async () => {
    const loadAdvertisedCommands = jest.fn().mockResolvedValue([{ name: 'compact' }]);
    const { controller } = setup({
      usage: usageAt(30),
      compact: { command: '/compact', availability: 'advertised' },
      loadAdvertisedCommands,
    });
    controller.refresh();
    await flush();
    expect(loadAdvertisedCommands).not.toHaveBeenCalled();
  });

  it('asks again after invalidation, e.g. once a runtime became ready', async () => {
    const loadAdvertisedCommands = jest.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce([{ name: 'compact' }]);
    const { controller, last } = setup({
      compact: { command: '/compact', availability: 'advertised' },
      loadAdvertisedCommands,
    });
    controller.refresh();
    await flush();
    expect(last()?.compactCommand).toBeNull();

    controller.invalidateCompactCommand();
    controller.refresh();
    await flush();
    expect(last()?.compactCommand).toBe('/compact');
  });

  it('hides after dismiss until usage climbs another step or reaches the next level', () => {
    const { controller, env, last } = setup({ usage: usageAt(82) });
    controller.refresh();
    controller.dismiss();
    expect(last()).toBeNull();

    env.usage = usageAt(86);
    controller.refresh();
    expect(last()).toBeNull();

    env.usage = usageAt(87);
    controller.refresh();
    expect(last()?.level).toBe('high');
  });

  it('remembers a dismissal per conversation across tabs, but not for other conversations', () => {
    const first = setup({ conversationId: 'shared-conv', usage: usageAt(84) });
    first.controller.refresh();
    first.controller.dismiss();

    const sameConversation = setup({ conversationId: 'shared-conv', usage: usageAt(85) });
    sameConversation.controller.refresh();
    expect(sameConversation.last()).toBeNull();

    const other = setup({ conversationId: 'other-conv', usage: usageAt(85) });
    other.controller.refresh();
    expect(other.last()?.level).toBe('high');
  });

  it('forgets the dismissal once pressure drops back to normal', () => {
    const { controller, env, last } = setup({ usage: usageAt(84) });
    controller.refresh();
    controller.dismiss();
    env.usage = usageAt(20);
    controller.refresh();
    env.usage = usageAt(84);
    controller.refresh();
    expect(last()?.level).toBe('high');
  });

  it('marks the state as streaming so the view can disable the actions', () => {
    const { controller, last } = setup({ streaming: true });
    controller.refresh();
    expect(last()?.streaming).toBe(true);
  });

  it('sends the compact command and steps aside while it runs', async () => {
    const { controller, deps, last } = setup({ usage: usageAt(88) });
    controller.refresh();
    await controller.compact();
    expect(deps.sendCompact).toHaveBeenCalledWith('/compact');
    expect(last()).toBeNull();
  });

  it('ignores compact while streaming or without a command', async () => {
    const streaming = setup({ streaming: true });
    streaming.controller.refresh();
    await streaming.controller.compact();
    expect(streaming.deps.sendCompact).not.toHaveBeenCalled();

    const none = setup({ compact: undefined });
    none.controller.refresh();
    await none.controller.compact();
    expect(none.deps.sendCompact).not.toHaveBeenCalled();
  });

  it('shows a condensing state while continuing with less context, once', async () => {
    let finish!: () => void;
    const continueWithLessContext = jest.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const { controller, env, last } = setup({ continueWithLessContext });
    controller.refresh();

    const pending = controller.continueWithLessContext();
    expect(last()?.condensing).toBe(true);
    await controller.continueWithLessContext();
    expect(continueWithLessContext).toHaveBeenCalledTimes(1);

    env.usage = null;
    finish();
    await pending;
    expect(last()).toBeNull();
  });

  it('keeps the warning when continuing failed and usage is still high', async () => {
    const { controller, last } = setup({
      continueWithLessContext: jest.fn().mockRejectedValue(new Error('disk full')),
    });
    controller.refresh();
    await controller.continueWithLessContext();
    expect(last()?.condensing).toBe(false);
    expect(last()?.level).toBe('high');
  });
});
