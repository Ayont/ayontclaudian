import { parseTodoInput } from '@/core/tools/todo';
import { TOOL_TODO_WRITE } from '@/core/tools/toolNames';
import type { StreamChunk } from '@/core/types';
import { AcpPlanTodoBridge, acpPlanToTodos } from '@/providers/acp/AcpPlanTodoBridge';
import type { AcpPlan } from '@/providers/acp/types';

function plan(...entries: AcpPlan['entries']): AcpPlan {
  return { entries };
}

function toolUseIds(chunks: StreamChunk[]): string[] {
  return chunks.flatMap((chunk) => (chunk.type === 'tool_use' ? [chunk.id] : []));
}

describe('acpPlanToTodos', () => {
  it('maps plan entries onto canonical todos', () => {
    const todos = acpPlanToTodos(plan(
      { content: 'Recon', priority: 'high', status: 'completed' },
      { content: 'Build', priority: 'low', status: 'in_progress' },
    ));

    expect(todos).toEqual([
      { activeForm: 'Recon', content: 'Recon', priority: 'high', status: 'completed' },
      { activeForm: 'Build', content: 'Build', priority: 'low', status: 'in_progress' },
    ]);
  });

  it('drops a priority every entry shares, because agents hard-code "medium"', () => {
    const todos = acpPlanToTodos(plan(
      { content: 'A', priority: 'medium', status: 'pending' },
      { content: 'B', priority: 'medium', status: 'pending' },
    ));

    expect(todos.every((todo) => todo.priority === undefined)).toBe(true);
  });

  it('skips entries without text', () => {
    expect(acpPlanToTodos(plan({ content: '  ', priority: 'high', status: 'pending' }))).toEqual([]);
  });
});

describe('AcpPlanTodoBridge', () => {
  it('turns a plan update into a synthetic TodoWrite pair', () => {
    const bridge = new AcpPlanTodoBridge();
    const turn = {};

    const chunks = bridge.fromPlan(turn, plan({ content: 'Recon', priority: 'medium', status: 'in_progress' }));

    expect(chunks).toHaveLength(2);
    const [use, result] = chunks;
    expect(use).toMatchObject({ name: TOOL_TODO_WRITE, type: 'tool_use' });
    expect(result).toMatchObject({ id: (use as { id: string }).id, isError: false, type: 'tool_result' });
    // The synthetic input must survive the shared parser the panel and card use.
    expect(parseTodoInput((use as { input: Record<string, unknown> }).input)).toEqual([
      { activeForm: 'Recon', content: 'Recon', status: 'in_progress' },
    ]);
  });

  it('reuses one id per turn so repeated plan updates update a single card', () => {
    const bridge = new AcpPlanTodoBridge();
    const turn = {};

    const first = bridge.fromPlan(turn, plan({ content: 'A', priority: 'medium', status: 'in_progress' }));
    const second = bridge.fromPlan(turn, plan({ content: 'A', priority: 'medium', status: 'completed' }));

    expect(toolUseIds(first)).toEqual(toolUseIds(second));
  });

  it('starts a new card for the next turn', () => {
    const bridge = new AcpPlanTodoBridge();

    const first = bridge.fromPlan({}, plan({ content: 'A', priority: 'medium', status: 'pending' }));
    const second = bridge.fromPlan({}, plan({ content: 'A', priority: 'medium', status: 'pending' }));

    expect(toolUseIds(first)[0]).not.toBe(toolUseIds(second)[0]);
  });

  it('attaches to the TodoWrite card the agent already opened in this turn', () => {
    const bridge = new AcpPlanTodoBridge();
    const turn = {};
    bridge.observe(turn, [
      { id: 'read-1', input: {}, name: 'Read', type: 'tool_use' },
      { id: 'todo-7', input: {}, name: TOOL_TODO_WRITE, type: 'tool_use' },
    ]);

    const chunks = bridge.fromPlan(turn, plan({ content: 'A', priority: 'medium', status: 'pending' }));

    expect(toolUseIds(chunks)).toEqual(['todo-7']);
    expect(chunks[1]).toMatchObject({ id: 'todo-7', type: 'tool_result' });
  });

  it('does not leak an observed card into another turn', () => {
    const bridge = new AcpPlanTodoBridge();
    bridge.observe({}, [{ id: 'todo-7', input: {}, name: TOOL_TODO_WRITE, type: 'tool_use' }]);

    const chunks = bridge.fromPlan({}, plan({ content: 'A', priority: 'medium', status: 'pending' }));

    expect(toolUseIds(chunks)).not.toEqual(['todo-7']);
  });

  it('emits nothing for an empty plan', () => {
    expect(new AcpPlanTodoBridge().fromPlan({}, plan())).toEqual([]);
  });
});
