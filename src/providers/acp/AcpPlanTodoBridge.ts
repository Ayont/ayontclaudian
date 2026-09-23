import { normalizeTodoItems, type TodoItem } from '../../core/tools/todo';
import { TOOL_TODO_WRITE } from '../../core/tools/toolNames';
import type { StreamChunk } from '../../core/types';
import type { AcpPlan } from './types';

const PLAN_RESULT_TEXT = 'Plan aktualisiert';

/**
 * ACP `plan` updates carry the agent's task list but no tool call, so the chat
 * never saw them. Hermes, OpenCode and Kimi hard-code every entry's priority to
 * "medium"; a priority all entries share says nothing and is dropped so the UI
 * only badges a priority that actually distinguishes a step.
 */
export function acpPlanToTodos(plan: AcpPlan): TodoItem[] {
  const todos = normalizeTodoItems(Array.isArray(plan.entries) ? plan.entries : []);
  const priorities = new Set(todos.map((todo) => todo.priority));
  if (priorities.size > 1) {
    return todos;
  }
  return todos.map(({ priority: _priority, ...todo }) => todo);
}

interface TurnPlanState {
  syntheticId: string;
  lastTodoToolId: string | null;
}

/**
 * Turns ACP plan updates into the same synthetic `TodoWrite` tool pair Codex
 * uses for `turn/plan/updated`, so the status panel and the inline card work
 * for every ACP agent without a provider-specific UI path.
 *
 * Turns are keyed by object identity (each runtime creates a fresh `activeTurn`
 * per query), so no runtime has to remember to reset the bridge. Within a turn
 * the pair targets one id: repeated plan updates re-render one card instead of
 * stacking copies, and an agent that ALSO emits its own todo tool call
 * (OpenCode `todowrite`, Hermes `todo`) gets that card filled instead of a twin.
 */
export class AcpPlanTodoBridge {
  private readonly turns = new WeakMap<object, TurnPlanState>();
  private turnCounter = 0;

  observe(turn: object, chunks: readonly StreamChunk[]): void {
    for (const chunk of chunks) {
      if (chunk.type === 'tool_use' && chunk.name === TOOL_TODO_WRITE) {
        this.stateFor(turn).lastTodoToolId = chunk.id;
      }
    }
  }

  fromPlan(turn: object, plan: AcpPlan): StreamChunk[] {
    const todos = acpPlanToTodos(plan);
    if (todos.length === 0) {
      return [];
    }

    const state = this.stateFor(turn);
    const id = state.lastTodoToolId ?? state.syntheticId;
    return [
      { id, input: { todos }, name: TOOL_TODO_WRITE, type: 'tool_use' },
      { content: PLAN_RESULT_TEXT, id, isError: false, type: 'tool_result' },
    ];
  }

  private stateFor(turn: object): TurnPlanState {
    let state = this.turns.get(turn);
    if (!state) {
      this.turnCounter += 1;
      state = { lastTodoToolId: null, syntheticId: `acp-plan-${Date.now().toString(36)}-${this.turnCounter}` };
      this.turns.set(turn, state);
    }
    return state;
  }
}
