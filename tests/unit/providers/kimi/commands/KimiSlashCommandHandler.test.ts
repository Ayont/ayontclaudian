import { KimiSlashCommandHandler } from '@/providers/kimi/commands/KimiSlashCommandHandler';
import type { KimiProviderState } from '@/providers/kimi/types';

function makeHandler(initial: KimiProviderState = { sessionId: 's1', goal: 'test goal' }) {
  let state: KimiProviderState = { ...initial };
  const updates: KimiProviderState[] = [];
  const opened: string[] = [];
  const closed: boolean[] = [];

  const handler = new KimiSlashCommandHandler(
    () => state,
    (u) => {
      updates.push(u);
      state = { ...state, ...u };
    },
    {
      openSessionList: () => opened.push('sessions'),
      openHelp: () => opened.push('help'),
      closeTab: () => closed.push(true),
    },
  );

  return { handler, getState: () => state, updates, opened, closed };
}

describe('KimiSlashCommandHandler', () => {
  it('consumes /new and clears state', async () => {
    const { handler, updates } = makeHandler();
    const result = await handler.execute('/new');
    expect(result.consumed).toBe(true);
    expect(result.followUpPrompt).toBe('Starting a new Kimi session.');
    expect(updates).toEqual([{ sessionId: undefined, goal: undefined, forkParentId: undefined }]);
  });

  it('consumes /fork and stores parent id', async () => {
    const { handler, getState } = makeHandler({ sessionId: 'parent-123' });
    const result = await handler.execute('/fork');
    expect(result.consumed).toBe(true);
    expect(result.followUpPrompt).toBe('Forked from session parent-123. Starting a fresh branch.');
    expect(getState().forkParentId).toBe('parent-123');
    expect(getState().sessionId).toBeUndefined();
  });

  it('/fork warns when there is no active session', async () => {
    const { handler } = makeHandler({});
    const result = await handler.execute('/fork');
    expect(result.consumed).toBe(true);
    expect(result.followUpPrompt).toBe('No active session to fork. Start a session first.');
  });

  it('consumes /exit', async () => {
    const { handler, closed } = makeHandler();
    const result = await handler.execute('/exit');
    expect(result.consumed).toBe(true);
    expect(closed).toEqual([true]);
  });

  it('consumes /sessions and opens modal', async () => {
    const { handler, opened } = makeHandler();
    const result = await handler.execute('/sessions');
    expect(result.consumed).toBe(true);
    expect(opened).toEqual(['sessions']);
  });

  it('passes through /model to Kimi', async () => {
    const { handler, opened } = makeHandler();
    const result = await handler.execute('/model');
    expect(result.consumed).toBe(false);
    expect(opened).toHaveLength(0);
  });

  it('consumes /help and opens help', async () => {
    const { handler, opened } = makeHandler();
    const result = await handler.execute('/help');
    expect(result.consumed).toBe(true);
    expect(opened).toEqual(['help']);
  });

  it('consumes /login and returns auth action', async () => {
    const { handler, updates } = makeHandler();
    const result = await handler.execute('/login');
    expect(result.consumed).toBe(true);
    expect(result.authAction).toBe('login');
    expect(updates).toHaveLength(0);
  });

  it('consumes /logout and returns auth action', async () => {
    const { handler, updates } = makeHandler();
    const result = await handler.execute('/logout');
    expect(result.consumed).toBe(true);
    expect(result.authAction).toBe('logout');
    expect(updates).toHaveLength(0);
  });

  it.each(['/compact', '/undo', '/usage', '/status', '/plan', '/yolo', '/auto', '/swarm test', '/tasks', '/model'])('passes through %s', async (input) => {
    const { handler, updates } = makeHandler();
    const result = await handler.execute(input);
    expect(result.consumed).toBe(false);
    expect(updates).toHaveLength(0);
  });

  it('ignores ordinary prompts', async () => {
    const { handler, updates, opened } = makeHandler();
    const result = await handler.execute('hello');
    expect(result.consumed).toBe(false);
    expect(updates).toHaveLength(0);
    expect(opened).toHaveLength(0);
  });
});
