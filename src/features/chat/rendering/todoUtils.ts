import { setIcon } from 'obsidian';

import {
  summarizeTodos,
  type TodoItem,
  type TodoPriority,
  type TodoStatus,
  type TodoSummary,
} from '../../../core/tools/todo';

/**
 * The one todo renderer. The persistent status panel and the inline TodoWrite
 * card both build their header summary and their list from here, so a todo
 * looks and behaves the same wherever an agent's plan shows up.
 *
 * Only a small DOM surface is used (createDiv/createSpan, setAttribute,
 * toggleClass, addEventListener): the status panel renders through a
 * document-created tree whose test double supports nothing more.
 */

/** A list longer than this folds its finished items into one row. */
export const TODO_GROUP_THRESHOLD = 6;
/** Folding a single finished item would only trade one row for another. */
const TODO_GROUP_MIN_COMPLETED = 2;
/** Below this, step numbers are noise rather than orientation. */
const TODO_NUMBERING_MIN_ITEMS = 4;
/** More segments than this would be thinner than a hairline in a sidebar. */
export const TODO_METER_MAX_SEGMENTS = 12;

const STATUS_LABELS: Record<TodoStatus, string> = {
  completed: 'Erledigt:',
  in_progress: 'In Arbeit:',
  pending: 'Offen:',
};

const PRIORITY_LABELS: Record<TodoPriority, string> = {
  high: 'Hoch',
  low: 'Niedrig',
  medium: 'Mittel',
};

const groupExpanded = new WeakMap<HTMLElement, boolean>();
const lastStatuses = new WeakMap<HTMLElement, Map<string, TodoStatus>>();
const collapseBodies = new WeakMap<HTMLElement, HTMLElement>();
const activeRows = new WeakMap<HTMLElement, { row: HTMLElement; scroller: HTMLElement }>();

export function getTodoDisplayText(todo: TodoItem): string {
  return todo.status === 'in_progress' ? todo.activeForm : todo.content;
}

export function getTodoToggleLabel(todos: readonly TodoItem[], expanded: boolean): string {
  const { completed, total } = summarizeTodos(todos);
  const action = expanded ? 'einklappen' : 'ausklappen';
  return `Aufgabenliste ${action} – ${completed} von ${total} erledigt`;
}

function setCssVar(el: HTMLElement, name: string, value: string): void {
  const style = el.style as CSSStyleDeclaration | undefined;
  if (typeof style?.setProperty === 'function') {
    style.setProperty(name, value);
  }
}

function renderMeter(container: HTMLElement, todos: readonly TodoItem[], summary: TodoSummary): void {
  const meter = container.createSpan({ cls: 'claudian-todo-meter' });
  meter.setAttribute('role', 'progressbar');
  meter.setAttribute('aria-valuemin', '0');
  meter.setAttribute('aria-valuemax', String(summary.total));
  meter.setAttribute('aria-valuenow', String(summary.completed));
  meter.setAttribute('aria-label', `${summary.completed} von ${summary.total} erledigt`);

  if (todos.length > TODO_METER_MAX_SEGMENTS) {
    meter.addClass('claudian-todo-meter--continuous');
    const fill = meter.createSpan({ cls: 'claudian-todo-meter-fill' });
    const ratio = summary.total > 0 ? summary.completed / summary.total : 0;
    setCssVar(fill, '--claudian-todo-progress', String(Math.round(ratio * 1000) / 1000));
    return;
  }

  for (const todo of todos) {
    meter.createSpan({ cls: `claudian-todo-meter-seg is-${todo.status}` });
  }
}

/**
 * Header summary: progress meter, count, and either the task in progress (with a
 * calm live dot) or a finished badge. Returns the summary so hosts can tint
 * themselves without recounting.
 */
export function renderTodoSummary(container: HTMLElement, todos: readonly TodoItem[]): TodoSummary {
  const summary = summarizeTodos(todos);
  container.empty();
  container.addClass('claudian-todo-summary');
  container.toggleClass('is-complete', summary.allCompleted);

  if (summary.total === 0) {
    return summary;
  }

  renderMeter(container, todos, summary);
  container.createSpan({ cls: 'claudian-todo-count', text: `${summary.completed}/${summary.total}` });

  if (summary.allCompleted) {
    const done = container.createSpan({ cls: 'claudian-todo-done' });
    const check = done.createSpan({ cls: 'claudian-todo-done-icon' });
    check.setAttribute('aria-hidden', 'true');
    setIcon(check, 'check');
    done.createSpan({ cls: 'claudian-todo-done-label', text: 'Alles erledigt' });
  } else if (summary.current) {
    const text = getTodoDisplayText(summary.current);
    const current = container.createSpan({ cls: 'claudian-todo-current' });
    current.setAttribute('title', text);
    current.createSpan({ cls: 'claudian-todo-pulse' }).setAttribute('aria-hidden', 'true');
    current.createSpan({ cls: 'claudian-todo-current-text', text });
  }

  return summary;
}

function todoKey(todo: TodoItem, index: number): string {
  return todo.id ?? `${index}:${todo.content}`;
}

function renderTodoRow(
  parent: HTMLElement,
  todo: TodoItem,
  index: number,
  options: { numbered: boolean; justDone: boolean },
): HTMLElement {
  const row = parent.createDiv({ cls: `claudian-todo-item claudian-todo-${todo.status}` });
  row.setAttribute('role', 'listitem');
  if (todo.status === 'in_progress') {
    row.setAttribute('aria-current', 'step');
  }
  if (options.justDone) {
    row.addClass('is-just-done');
  }

  if (options.numbered) {
    row.createSpan({ cls: 'claudian-todo-step', text: String(index + 1) }).setAttribute('aria-hidden', 'true');
  }

  const icon = row.createSpan({ cls: 'claudian-todo-status-icon' });
  icon.setAttribute('aria-hidden', 'true');
  if (todo.status === 'completed') {
    setIcon(icon, 'check');
  }

  row.createSpan({ cls: 'claudian-todo-sr', text: STATUS_LABELS[todo.status] });
  row.createSpan({ cls: 'claudian-todo-text', text: getTodoDisplayText(todo) });

  if (todo.priority) {
    const chip = row.createSpan({ cls: `claudian-todo-priority claudian-todo-priority--${todo.priority}` });
    chip.createSpan({ cls: 'claudian-todo-sr', text: 'Priorität' });
    chip.createSpan({ cls: 'claudian-todo-priority-label', text: PRIORITY_LABELS[todo.priority] });
  }

  return row;
}

function bindToggle(el: HTMLElement, toggle: () => void): void {
  el.addEventListener('click', (event: Event) => {
    event.stopPropagation?.();
    toggle();
  });
  el.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation?.();
      toggle();
    }
  });
}

function renderCompletedGroup(
  scroller: HTMLElement,
  owner: HTMLElement,
  entries: Array<{ index: number; todo: TodoItem }>,
  renderRow: (parent: HTMLElement, todo: TodoItem, index: number) => void,
): void {
  const group = scroller.createDiv({ cls: 'claudian-todo-group' });
  group.setAttribute('role', 'listitem');

  const toggle = group.createDiv({ cls: 'claudian-todo-group-toggle' });
  toggle.setAttribute('role', 'button');
  toggle.setAttribute('tabindex', '0');
  const icon = toggle.createSpan({ cls: 'claudian-todo-status-icon claudian-todo-group-icon' });
  icon.setAttribute('aria-hidden', 'true');
  setIcon(icon, 'check');
  toggle.createSpan({ cls: 'claudian-todo-group-label', text: `${entries.length} erledigt` });
  const chevron = toggle.createSpan({ cls: 'claudian-todo-group-chevron' });
  chevron.setAttribute('aria-hidden', 'true');
  setIcon(chevron, 'chevron-down');

  const body = group.createDiv({ cls: 'claudian-todo-group-body' });
  const inner = mountTodoCollapse(body);
  inner.setAttribute('role', 'list');
  for (const { index, todo } of entries) {
    renderRow(inner, todo, index);
  }

  const apply = (expanded: boolean) => {
    group.toggleClass('is-expanded', expanded);
    body.toggleClass('claudian-todo-collapsed', !expanded);
    toggle.setAttribute('aria-expanded', String(expanded));
    const verb = expanded ? 'ausblenden' : 'einblenden';
    toggle.setAttribute('aria-label', `${entries.length} erledigte Aufgaben ${verb}`);
  };
  apply(groupExpanded.get(owner) ?? false);
  bindToggle(toggle, () => {
    const next = !(groupExpanded.get(owner) ?? false);
    groupExpanded.set(owner, next);
    apply(next);
  });
}

function shouldGroupCompleted(summary: TodoSummary): boolean {
  return summary.total > TODO_GROUP_THRESHOLD
    && summary.completed >= TODO_GROUP_MIN_COMPLETED
    && !summary.allCompleted;
}

/**
 * The list body. Long lists keep their open work in view: finished items fold
 * into one "N erledigt" row, the area is height-capped with scroll fades, and
 * the task in progress is scrolled into view inside the list only (never the
 * transcript around it).
 */
export function renderTodoItems(container: HTMLElement, todos: readonly TodoItem[]): void {
  container.empty();
  container.addClass('claudian-todo-list-container');

  const summary = summarizeTodos(todos);
  const previous = lastStatuses.get(container);
  const next = new Map<string, TodoStatus>();
  const numbered = todos.length >= TODO_NUMBERING_MIN_ITEMS;
  const active: { row: HTMLElement | null } = { row: null };

  const renderRow = (parent: HTMLElement, todo: TodoItem, index: number) => {
    const key = todoKey(todo, index);
    next.set(key, todo.status);
    const before = previous?.get(key);
    const row = renderTodoRow(parent, todo, index, {
      justDone: todo.status === 'completed' && before !== undefined && before !== 'completed',
      numbered,
    });
    if (index === summary.currentIndex) {
      active.row = row;
    }
  };

  const scroller = container.createDiv({ cls: 'claudian-todo-scroll' });
  // Lets the fold row indent past the step-number column.
  scroller.toggleClass('is-numbered', numbered);
  scroller.setAttribute('role', 'list');
  scroller.setAttribute('aria-label', 'Aufgaben');

  const entries = todos.map((todo, index) => ({ index, todo }));
  if (shouldGroupCompleted(summary)) {
    renderCompletedGroup(scroller, container, entries.filter(({ todo }) => todo.status === 'completed'), renderRow);
    for (const { index, todo } of entries) {
      if (todo.status !== 'completed') {
        renderRow(scroller, todo, index);
      }
    }
  } else {
    for (const { index, todo } of entries) {
      renderRow(scroller, todo, index);
    }
  }

  lastStatuses.set(container, next);
  if (active.row) {
    activeRows.set(container, { row: active.row, scroller });
    revealActiveTodo(container);
  } else {
    activeRows.delete(container);
  }
}

/** Scrolls only the list itself so the task in progress is fully visible. */
export function revealActiveTodo(container: HTMLElement): void {
  const target = activeRows.get(container);
  if (!target) {
    return;
  }
  const view = target.scroller.ownerDocument?.defaultView;
  const run = () => {
    const { row, scroller } = target;
    const top = row.offsetTop;
    const height = row.offsetHeight;
    const viewport = scroller.clientHeight;
    if (typeof top !== 'number' || typeof height !== 'number' || !viewport) {
      return;
    }
    const visibleTop = scroller.scrollTop;
    if (top >= visibleTop && top + height <= visibleTop + viewport) {
      return;
    }
    scroller.scrollTop = Math.max(0, top - (viewport - height) / 2);
  };
  if (typeof view?.requestAnimationFrame === 'function') {
    view.requestAnimationFrame(run);
  } else {
    run();
  }
}

/**
 * Makes `outer` an animated collapse (grid rows 0fr ↔ 1fr, toggled by
 * `claudian-todo-collapsed`) and returns its single inner body, reused across
 * renders so per-list state such as the folded group survives updates.
 */
export function mountTodoCollapse(outer: HTMLElement): HTMLElement {
  outer.addClass('claudian-todo-collapse');
  const existing = collapseBodies.get(outer);
  // A host that emptied itself dropped the body; build a fresh one.
  if (existing && (typeof outer.contains !== 'function' || outer.contains(existing))) {
    return existing;
  }
  const inner = outer.createDiv({ cls: 'claudian-todo-collapse-inner' });
  collapseBodies.set(outer, inner);
  return inner;
}
