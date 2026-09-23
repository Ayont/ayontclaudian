import type { AuxQueryRunner } from '@/core/auxiliary/AuxQueryRunner';
import type { ChatMessage, Conversation } from '@/core/types';
import {
  type CondensedSessionDeps,
  startCondensedSession,
} from '@/features/chat/tabs/condensedSession';
import { setLocale } from '@/i18n/i18n';

function history(count = 4, size = 20): ChatMessage[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `m${index}`,
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `${index % 2 === 0 ? 'frage' : 'antwort'}-${index} ${'x'.repeat(size)}`,
    timestamp: index,
  }));
}

function setup(overrides: Partial<CondensedSessionDeps> & { messages?: ChatMessage[] } = {}) {
  const env = {
    messages: overrides.messages ?? history(),
    streaming: false,
    conversationId: 'conv-1' as string | null,
    providerId: 'codex',
    pending: null as string | null,
    persisted: [] as Array<Partial<Conversation>>,
    order: [] as string[],
  };
  const deps: CondensedSessionDeps = {
    isStreaming: () => env.streaming,
    getConversationId: () => env.conversationId,
    getProviderId: () => env.providerId,
    getMessages: () => [...env.messages],
    setMessages: (messages) => { env.order.push('setMessages'); env.messages = messages; },
    getGoal: () => null,
    getContextWindow: () => 200_000,
    createSummaryRunner: () => null,
    recordAuxiliaryUsage: jest.fn(),
    releaseRuntime: jest.fn(() => { env.order.push('releaseRuntime'); }),
    persist: jest.fn(async (updates) => { env.order.push('persist'); env.persisted.push(updates); }),
    setPendingBootstrap: (carry) => { env.pending = carry; },
    clearUsage: jest.fn(() => { env.order.push('clearUsage'); }),
    renderBoundary: jest.fn(() => { env.order.push('renderBoundary'); }),
    notify: jest.fn(),
    ...overrides,
  };
  return { env, deps };
}

describe('startCondensedSession', () => {
  afterEach(() => setLocale('en'));

  it('starts a fresh provider session and keeps the visible transcript', async () => {
    const { env, deps } = setup();
    const before = env.messages.map((message) => message.id);

    await expect(startCondensedSession(deps)).resolves.toBe('started');

    expect(env.messages.map((message) => message.id)).toEqual(before);
    expect(env.messages[env.messages.length - 1].sessionBoundary).toBe('condensed');
    expect(env.messages.slice(0, -1).every((message) => !message.sessionBoundary)).toBe(true);
    expect(env.pending).toContain('<conversation_context>');
    expect(env.pending).toContain('antwort-3');

    const updates = env.persisted[0];
    expect(updates.sessionId).toBeNull();
    expect('providerState' in updates && updates.providerState === undefined).toBe(true);
    expect('resumeAtMessageId' in updates && updates.resumeAtMessageId === undefined).toBe(true);
    expect('usage' in updates && updates.usage === undefined).toBe(true);
    expect(updates.pendingContextBootstrap).toBe(env.pending);
    expect(updates.messages).toBe(env.messages);
    expect(deps.clearUsage).toHaveBeenCalled();
    expect(deps.renderBoundary).toHaveBeenCalled();
  });

  it('drops the old runtime before anything persists, so no save can resurrect the old session', async () => {
    const { env, deps } = setup();
    await startCondensedSession(deps);
    expect(env.order.indexOf('releaseRuntime')).toBeLessThan(env.order.indexOf('persist'));
    expect(env.order.indexOf('releaseRuntime')).toBeLessThan(env.order.indexOf('setMessages'));
  });

  it('carries the standing goal into the new session', async () => {
    const { env, deps } = setup({ getGoal: () => 'Release 2.6 fertig machen' });
    await startCondensedSession(deps);
    expect(env.pending).toContain('<standing_goal>\nRelease 2.6 fertig machen\n</standing_goal>');
  });

  it('keeps the carry clearly below the size of a provider switch carry', async () => {
    const { env, deps } = setup({ messages: history(60, 2_000), getContextWindow: () => 20_000 });
    await startCondensedSession(deps);
    // 20k tokens → 80k chars for a switch; the condensed carry stays at 18 %.
    expect(env.pending!.length).toBeLessThanOrEqual(Math.round(80_000 * 0.18));
    expect(env.pending).toContain('[earlier turns omitted]');
  });

  it('refuses while an answer is streaming', async () => {
    setLocale('de');
    const { env, deps } = setup();
    env.streaming = true;
    await expect(startCondensedSession(deps)).resolves.toBe('busy');
    expect(deps.notify).toHaveBeenCalledWith('Eine Antwort läuft noch. Bitte nach dem Ende erneut versuchen.');
    expect(deps.releaseRuntime).not.toHaveBeenCalled();
    expect(deps.persist).not.toHaveBeenCalled();
  });

  it('uses a model summary when older turns would be dropped', async () => {
    const runner: AuxQueryRunner = {
      reset: jest.fn(),
      query: jest.fn().mockResolvedValue('Bisher: Build repariert, Release offen.'),
    };
    const { env, deps } = setup({
      messages: history(60, 2_000),
      getContextWindow: () => 20_000,
      createSummaryRunner: () => ({ runner, model: 'gpt-test' }),
    });
    await startCondensedSession(deps);
    expect(runner.query).toHaveBeenCalledTimes(1);
    expect(env.pending).toContain('<condensed_summary>\nBisher: Build repariert, Release offen.\n</condensed_summary>');
    expect(deps.recordAuxiliaryUsage).toHaveBeenCalledWith(expect.objectContaining({
      providerId: 'codex',
      model: 'gpt-test',
      outputText: 'Bisher: Build repariert, Release offen.',
    }));
  });

  it('skips the model summary when the whole transcript fits', async () => {
    const createSummaryRunner = jest.fn(() => null);
    const { deps } = setup({ createSummaryRunner });
    await startCondensedSession(deps);
    expect(createSummaryRunner).not.toHaveBeenCalled();
  });

  it('falls back to the deterministic carry when the summary fails', async () => {
    const runner: AuxQueryRunner = { reset: jest.fn(), query: jest.fn().mockRejectedValue(new Error('offline')) };
    const { env, deps } = setup({
      messages: history(60, 2_000),
      getContextWindow: () => 20_000,
      createSummaryRunner: () => ({ runner }),
    });
    await expect(startCondensedSession(deps)).resolves.toBe('started');
    expect(env.pending).not.toContain('<condensed_summary>');
    expect(env.pending).toContain('antwort-59');
  });

  it('aborts when the conversation changed while the summary was written', async () => {
    const { env, deps } = setup({ messages: history(60, 2_000), getContextWindow: () => 20_000 });
    deps.createSummaryRunner = () => ({
      runner: {
        reset: jest.fn(),
        query: jest.fn(async () => {
          env.messages = [...env.messages, { id: 'late', role: 'user', content: 'neu', timestamp: 99 }];
          return 'zu spät';
        }),
      },
    });
    await expect(startCondensedSession(deps)).resolves.toBe('aborted');
    expect(deps.releaseRuntime).not.toHaveBeenCalled();
    expect(deps.persist).not.toHaveBeenCalled();
    expect(deps.notify).toHaveBeenCalled();
  });

  it('reports a failed save instead of swallowing it; the fresh session is still armed in memory', async () => {
    const { env, deps } = setup({ persist: jest.fn().mockRejectedValue(new Error('disk full')) });
    await expect(startCondensedSession(deps)).resolves.toBe('unsaved');
    expect(deps.notify).toHaveBeenCalledWith('The new session could not be saved: disk full');
    expect(env.pending).toContain('<conversation_context>');
    expect(deps.renderBoundary).toHaveBeenCalled();
  });

  it('does nothing without a bound conversation', async () => {
    const { env, deps } = setup();
    env.conversationId = null;
    await expect(startCondensedSession(deps)).resolves.toBe('failed');
    expect(deps.releaseRuntime).not.toHaveBeenCalled();
  });
});
