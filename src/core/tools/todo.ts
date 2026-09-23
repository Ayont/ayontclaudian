/**
 * Todo tool helpers.
 *
 * Every provider reports its task list in its own dialect (Claude's TodoWrite,
 * Codex `update_plan`, ACP `plan` entries, Hermes/Cline/dsh raw lists). They all
 * funnel through `normalizeTodoItems`, so the UI only ever sees `TodoItem`.
 */

import { TOOL_TODO_WRITE } from './toolNames';

export type TodoStatus = 'pending' | 'in_progress' | 'completed';
export type TodoPriority = 'high' | 'medium' | 'low';

export interface TodoItem {
  /** Imperative description (e.g., "Run tests") */
  content: string;
  status: TodoStatus;
  /** Present continuous form (e.g., "Running tests"); falls back to `content`. */
  activeForm: string;
  priority?: TodoPriority;
  id?: string;
}

export interface TodoSummary {
  total: number;
  completed: number;
  current?: TodoItem;
  /** Index of `current` in the list, -1 when nothing is in progress. */
  currentIndex: number;
  /** False for an empty list: nothing finished, nothing to celebrate. */
  allCompleted: boolean;
}

const TEXT_KEYS = ['content', 'title', 'text', 'step', 'description'] as const;
const ACTIVE_FORM_KEYS = ['activeForm', 'active_form'] as const;
// Containers other providers put the list under; `todos` stays authoritative.
const LIST_KEYS = ['todos', 'entries', 'plan'] as const;

const STATUS_ALIASES: Record<string, TodoStatus> = {
  active: 'in_progress',
  canceled: 'completed',
  cancelled: 'completed',
  complete: 'completed',
  completed: 'completed',
  done: 'completed',
  in_progress: 'in_progress',
  inprogress: 'in_progress',
  pending: 'pending',
  running: 'in_progress',
};

const PRIORITIES = new Set<TodoPriority>(['high', 'medium', 'low']);

function firstText(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

export function normalizeTodoStatus(value: unknown): TodoStatus {
  if (typeof value !== 'string') {
    return 'pending';
  }
  const key = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return STATUS_ALIASES[key] ?? STATUS_ALIASES[key.replace(/_/g, '')] ?? 'pending';
}

function normalizePriority(value: unknown): TodoPriority | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const key = value.trim().toLowerCase() as TodoPriority;
  return PRIORITIES.has(key) ? key : undefined;
}

function normalizeId(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeTodoItem(item: unknown): TodoItem | null {
  if (typeof item === 'string') {
    const content = item.trim();
    return content ? { content, status: 'pending', activeForm: content } : null;
  }
  if (typeof item !== 'object' || item === null || Array.isArray(item)) {
    return null;
  }

  const record = item as Record<string, unknown>;
  const content = firstText(record, TEXT_KEYS);
  if (!content) {
    return null;
  }

  const priority = normalizePriority(record.priority);
  const id = normalizeId(record.id);
  return {
    content,
    status: normalizeTodoStatus(record.status),
    activeForm: firstText(record, ACTIVE_FORM_KEYS) ?? content,
    ...(priority ? { priority } : {}),
    ...(id ? { id } : {}),
  };
}

/** Canonical items from any provider's raw list; unusable entries are dropped. */
export function normalizeTodoItems(value: unknown): TodoItem[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const items: TodoItem[] = [];
  for (const entry of value) {
    const todo = normalizeTodoItem(entry);
    if (todo) {
      items.push(todo);
    }
  }
  return items;
}

export function parseTodoInput(input: Record<string, unknown>): TodoItem[] | null {
  const safeInput = input ?? {};
  const list = LIST_KEYS.map((key) => safeInput[key]).find(Array.isArray);
  if (!list) {
    return null;
  }

  const todos = normalizeTodoItems(list);
  return todos.length > 0 ? todos : null;
}

export function summarizeTodos(todos: readonly TodoItem[]): TodoSummary {
  const completed = todos.filter((todo) => todo.status === 'completed').length;
  const currentIndex = todos.findIndex((todo) => todo.status === 'in_progress');
  return {
    total: todos.length,
    completed,
    ...(currentIndex >= 0 ? { current: todos[currentIndex] } : {}),
    currentIndex,
    allCompleted: todos.length > 0 && completed === todos.length,
  };
}

export function areAllTodosCompleted(todos: readonly TodoItem[] | null | undefined): boolean {
  return todos ? summarizeTodos(todos).allCompleted : false;
}

type TodoSourceMessage = {
  role: string;
  toolCalls?: Array<{ name: string; input: Record<string, unknown> }>;
};

/**
 * Extract the last TodoWrite todos from a list of messages.
 * Used to restore the todo panel when loading a saved conversation.
 */
export function extractLastTodosFromMessages(messages: TodoSourceMessage[]): TodoItem[] | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === 'assistant' && msg.toolCalls) {
      for (let j = msg.toolCalls.length - 1; j >= 0; j--) {
        const toolCall = msg.toolCalls[j];
        if (toolCall.name === TOOL_TODO_WRITE) {
          return parseTodoInput(toolCall.input);
        }
      }
    }
  }
  return null;
}

/**
 * The list the status panel should show after a reload. A finished list stays
 * hidden, matching the auto-hide at response end, so reopening a chat does not
 * resurrect a panel the user already saw disappear.
 */
export function getRestorableTodos(messages: TodoSourceMessage[]): TodoItem[] | null {
  const todos = extractLastTodosFromMessages(messages);
  return todos && !areAllTodosCompleted(todos) ? todos : null;
}
