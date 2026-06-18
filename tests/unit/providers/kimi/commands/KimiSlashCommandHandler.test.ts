import { KimiSlashCommandHandler } from '@/providers/kimi/commands/KimiSlashCommandHandler';
import type { KimiProviderState } from '@/providers/kimi/types';

function makeHandler(initial: KimiProviderState = { sessionId: 's1', goal: 'test goal' }) {
  let state: KimiProviderState = { ...initial };
  const updates: KimiProviderState[] = [];
  const opened: string[] = [];
  const closed: boolean[] = [];
  const followUps: (string | undefined)[] = [];

  const handler = new KimiSlashCommandHandler(
    () => state,
    (u) => {
      updates.push(u);
      state = { ...state, ...u };
    },
    {
      openSessionList: () => opened.push('sessions'),
      openModelPicker: () => opened.push('model'),
      openHelp: () => opened.push('help'),
      closeTab: () => closed.push(true),
    },
    (p) => followUps.push(p),
  );

  return { handler, getState: () => state, updates, opened, closed, followUps };
}

describe('KimiSlashCommandHandler', () => {
  it('consumes /new and clears state', async () => {
    const { handler, updates, followUps } = makeHandler();
    const result = await handler.execute('/new');
    expect(result.consumed).toBe(true);
    expect(updates).toEqual([{ sessionId: undefined, goal: undefined, forkParentId: undefined }]);
    expect(followUps).toEqual(['Starting a new Kimi session.']);
  });

  it('consumes /fork and stores parent id', async () => {
    const { handler, getState, followUps } = makeHandler({ sessionId: 'parent-123' });
    const result = await handler.execute('/fork');
    expect(result.consumed).toBe(true);
    expect(getState().forkParentId).toBe('parent-123');
    expect(getState().sessionId).toBeUndefined();
    expect(followUps).toEqual(['Forked from session parent-123. Starting a fresh branch.']);
  });

  it('/fork warns when there is no active session', async () => {
    const { handler, followUps } = makeHandler({});
    const result = await handler.execute('/fork');
    expect(result.consumed).toBe(true);
    expect(followUps).toEqual(['No active session to fork. Start a session first.']);
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

  it('consumes /model and opens picker', async () => {
    const { handler, opened } = makeHandler();
    const result = await handler.execute('/model');
    expect(result.consumed).toBe(true);
    expect(opened).toEqual(['model']);
  });

  it('consumes /help and opens help', async () => {
    const { handler, opened } = makeHandler();
    const result = await handler.execute('/help');
    expect(result.consumed).toBe(true);
    expect(opened).toEqual(['help']);
  });

  it.each(['/compact', '/undo', '/usage', '/status', '/plan', '/swarm test', '/tasks'])('passes through %s', async (input) => {
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
