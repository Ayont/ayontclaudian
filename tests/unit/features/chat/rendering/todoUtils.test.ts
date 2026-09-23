import { createMockEl } from '@test/helpers/mockElement';
import { setIcon } from 'obsidian';

import type { TodoItem } from '@/core/tools/todo';
import {
  getTodoDisplayText,
  getTodoToggleLabel,
  mountTodoCollapse,
  renderTodoItems,
  renderTodoSummary,
} from '@/features/chat/rendering/todoUtils';

jest.mock('obsidian', () => ({
  setIcon: jest.fn(),
}));

function todo(content: string, status: TodoItem['status'], extra: Partial<TodoItem> = {}): TodoItem {
  return { activeForm: `${content} läuft`, content, status, ...extra };
}

/** Depth-first walk over the mock tree, root excluded. */
function all(root: any): any[] {
  const out: any[] = [];
  const walk = (el: any) => {
    for (const child of el._children ?? []) {
      out.push(child);
      walk(child);
    }
  };
  walk(root);
  return out;
}

function byClass(root: any, cls: string): any[] {
  return all(root).filter((el) => el.hasClass?.(cls));
}

function rows(root: any): any[] {
  return byClass(root, 'claudian-todo-item');
}

function textOf(row: any): string {
  return byClass(row, 'claudian-todo-text')[0]?.textContent ?? '';
}

function press(el: any, key: string): void {
  el.dispatchEvent({ key, preventDefault: jest.fn(), type: 'keydown' });
}

const TWELVE: TodoItem[] = [
  todo('Recon', 'completed'),
  todo('Referenz lesen', 'completed'),
  todo('Scaffold', 'completed'),
  todo('Parser', 'pending'),
  todo('Registrierung', 'completed'),
  todo('Icons', 'completed'),
  todo('Locales', 'pending'),
  todo('Performance', 'in_progress'),
  todo('Design', 'pending'),
  todo('Typecheck', 'pending'),
  todo('Lint', 'pending'),
  todo('Build', 'pending'),
];

describe('todoUtils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getTodoDisplayText', () => {
    it('shows the active form only for the task in progress', () => {
      expect(getTodoDisplayText(todo('Fix bug', 'in_progress'))).toBe('Fix bug läuft');
      expect(getTodoDisplayText(todo('Fix bug', 'completed'))).toBe('Fix bug');
      expect(getTodoDisplayText(todo('Fix bug', 'pending'))).toBe('Fix bug');
    });
  });

  describe('getTodoToggleLabel', () => {
    it('names the action and the progress in German', () => {
      const todos = [todo('A', 'completed'), todo('B', 'pending')];
      expect(getTodoToggleLabel(todos, false)).toBe('Aufgabenliste ausklappen – 1 von 2 erledigt');
      expect(getTodoToggleLabel(todos, true)).toBe('Aufgabenliste einklappen – 1 von 2 erledigt');
    });
  });

  describe('renderTodoItems', () => {
    it('renders one list row per todo with its status', () => {
      const container = createMockEl();

      renderTodoItems(container, [todo('A', 'completed'), todo('B', 'in_progress'), todo('C', 'pending')]);

      const list = byClass(container, 'claudian-todo-scroll')[0];
      expect(list.getAttribute('role')).toBe('list');
      const items = rows(container);
      expect(items.map((row) => row.getAttribute('role'))).toEqual(['listitem', 'listitem', 'listitem']);
      expect(items[0].hasClass('claudian-todo-completed')).toBe(true);
      expect(items[1].hasClass('claudian-todo-in_progress')).toBe(true);
      expect(items[2].hasClass('claudian-todo-pending')).toBe(true);
      expect(items.map(textOf)).toEqual(['A', 'B läuft', 'C']);
      expect(items[1].getAttribute('aria-current')).toBe('step');
      expect(items[0].getAttribute('aria-current')).toBeNull();
    });

    it('clears the previous render', () => {
      const container = createMockEl();
      renderTodoItems(container, [todo('Old', 'pending'), todo('Older', 'pending')]);

      renderTodoItems(container, [todo('New', 'pending')]);

      expect(rows(container).map(textOf)).toEqual(['New']);
    });

    it('draws a check only for finished items; open items use the CSS ring', () => {
      const container = createMockEl();

      renderTodoItems(container, [todo('A', 'completed'), todo('B', 'in_progress'), todo('C', 'pending')]);

      expect(setIcon).toHaveBeenCalledTimes(1);
      expect(setIcon).toHaveBeenCalledWith(expect.anything(), 'check');
      for (const icon of byClass(container, 'claudian-todo-status-icon')) {
        expect(icon.getAttribute('aria-hidden')).toBe('true');
      }
    });

    it('announces each status in words, never by icon alone', () => {
      const container = createMockEl();

      renderTodoItems(container, [todo('A', 'completed'), todo('B', 'in_progress'), todo('C', 'pending')]);

      expect(rows(container).map((row) => byClass(row, 'claudian-todo-sr')[0]?.textContent))
        .toEqual(['Erledigt:', 'In Arbeit:', 'Offen:']);
    });

    it('numbers the steps once a list is long enough to need it', () => {
      const short = createMockEl();
      renderTodoItems(short, [todo('A', 'pending'), todo('B', 'pending'), todo('C', 'pending')]);
      expect(byClass(short, 'claudian-todo-step')).toHaveLength(0);

      const long = createMockEl();
      renderTodoItems(long, [todo('A', 'pending'), todo('B', 'pending'), todo('C', 'pending'), todo('D', 'pending')]);
      expect(byClass(long, 'claudian-todo-step').map((el) => el.textContent)).toEqual(['1', '2', '3', '4']);
    });

    it('shows a priority chip only when the item has a priority', () => {
      const container = createMockEl();

      renderTodoItems(container, [
        todo('A', 'pending', { priority: 'high' }),
        todo('B', 'pending'),
        todo('C', 'pending', { priority: 'low' }),
      ]);

      const items = rows(container);
      expect(byClass(items[0], 'claudian-todo-priority')[0].hasClass('claudian-todo-priority--high')).toBe(true);
      expect(byClass(items[0], 'claudian-todo-priority-label')[0].textContent).toBe('Hoch');
      expect(byClass(items[1], 'claudian-todo-priority')).toHaveLength(0);
      expect(byClass(items[2], 'claudian-todo-priority-label')[0].textContent).toBe('Niedrig');
    });

    describe('many todos', () => {
      it('folds finished items into one "N erledigt" row and keeps open ones in order', () => {
        const container = createMockEl();

        renderTodoItems(container, TWELVE);

        const toggle = byClass(container, 'claudian-todo-group-toggle')[0];
        expect(byClass(toggle, 'claudian-todo-group-label')[0].textContent).toBe('5 erledigt');
        expect(toggle.getAttribute('role')).toBe('button');
        expect(toggle.getAttribute('tabindex')).toBe('0');
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        expect(toggle.getAttribute('aria-label')).toBe('5 erledigte Aufgaben einblenden');

        const groupBody = byClass(container, 'claudian-todo-group-body')[0];
        expect(groupBody.hasClass('claudian-todo-collapsed')).toBe(true);
        expect(rows(groupBody).map(textOf)).toEqual(['Recon', 'Referenz lesen', 'Scaffold', 'Registrierung', 'Icons']);

        const open = rows(container).filter((row) => !rows(groupBody).includes(row));
        expect(open.map(textOf)).toEqual(['Parser', 'Locales', 'Performance läuft', 'Design', 'Typecheck', 'Lint', 'Build']);
        // Step numbers keep the original order visible after folding.
        expect(byClass(open[2], 'claudian-todo-step')[0].textContent).toBe('8');
      });

      it('expands the finished group by click and keyboard, and remembers it across updates', () => {
        const container = createMockEl();
        renderTodoItems(container, TWELVE);
        let toggle = byClass(container, 'claudian-todo-group-toggle')[0];

        toggle.click();
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        expect(toggle.getAttribute('aria-label')).toBe('5 erledigte Aufgaben ausblenden');
        expect(byClass(container, 'claudian-todo-group-body')[0].hasClass('claudian-todo-collapsed')).toBe(false);

        renderTodoItems(container, TWELVE);
        toggle = byClass(container, 'claudian-todo-group-toggle')[0];
        expect(toggle.getAttribute('aria-expanded')).toBe('true');

        press(toggle, 'Enter');
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        press(toggle, ' ');
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
      });

      it('does not fold short lists, finished lists or a single finished item', () => {
        const short = createMockEl();
        renderTodoItems(short, TWELVE.slice(0, 6));
        expect(byClass(short, 'claudian-todo-group')).toHaveLength(0);

        const finished = createMockEl();
        renderTodoItems(finished, TWELVE.map((item) => ({ ...item, status: 'completed' as const })));
        expect(byClass(finished, 'claudian-todo-group')).toHaveLength(0);

        const oneDone = createMockEl();
        renderTodoItems(oneDone, TWELVE.map((item, index) => ({ ...item, status: index === 0 ? 'completed' as const : 'pending' as const })));
        expect(byClass(oneDone, 'claudian-todo-group')).toHaveLength(0);
      });
    });

    it('marks an item that just finished so its check can land once', () => {
      const container = createMockEl();
      renderTodoItems(container, [todo('A', 'in_progress'), todo('B', 'pending')]);
      expect(byClass(container, 'is-just-done')).toHaveLength(0);

      renderTodoItems(container, [todo('A', 'completed'), todo('B', 'in_progress')]);

      const justDone = byClass(container, 'is-just-done');
      expect(justDone).toHaveLength(1);
      expect(textOf(justDone[0])).toBe('A');

      renderTodoItems(container, [todo('A', 'completed'), todo('B', 'in_progress')]);
      expect(byClass(container, 'is-just-done')).toHaveLength(0);
    });
  });

  describe('renderTodoSummary', () => {
    it('shows a segmented meter, the count and the task in progress', () => {
      const container = createMockEl();

      renderTodoSummary(container, [todo('A', 'completed'), todo('B', 'in_progress'), todo('C', 'pending')]);

      expect(container.hasClass('claudian-todo-summary')).toBe(true);
      const meter = byClass(container, 'claudian-todo-meter')[0];
      expect(meter.getAttribute('role')).toBe('progressbar');
      expect(meter.getAttribute('aria-valuenow')).toBe('1');
      expect(meter.getAttribute('aria-valuemax')).toBe('3');
      expect(meter.getAttribute('aria-label')).toBe('1 von 3 erledigt');
      const segments = byClass(meter, 'claudian-todo-meter-seg');
      expect(segments.map((seg) => seg.getClasses().find((cls: string) => cls.startsWith('is-')))).toEqual([
        'is-completed', 'is-in_progress', 'is-pending',
      ]);
      expect(byClass(container, 'claudian-todo-count')[0].textContent).toBe('1/3');
      expect(byClass(container, 'claudian-todo-current-text')[0].textContent).toBe('B läuft');
      expect(byClass(container, 'claudian-todo-done')).toHaveLength(0);
      expect(container.hasClass('is-complete')).toBe(false);
    });

    it('switches to a finished state when everything is done', () => {
      const container = createMockEl();

      const summary = renderTodoSummary(container, [todo('A', 'completed'), todo('B', 'completed')]);

      expect(summary.allCompleted).toBe(true);
      expect(container.hasClass('is-complete')).toBe(true);
      expect(byClass(container, 'claudian-todo-done-label')[0].textContent).toBe('Alles erledigt');
      expect(byClass(container, 'claudian-todo-current')).toHaveLength(0);
      expect(setIcon).toHaveBeenCalledWith(expect.anything(), 'check');
    });

    it('uses one continuous bar once segments would get too thin', () => {
      const container = createMockEl();
      const many = Array.from({ length: 20 }, (_, index) => todo(`T${index}`, index < 5 ? 'completed' : 'pending'));

      renderTodoSummary(container, many);

      const meter = byClass(container, 'claudian-todo-meter')[0];
      expect(meter.hasClass('claudian-todo-meter--continuous')).toBe(true);
      expect(byClass(meter, 'claudian-todo-meter-seg')).toHaveLength(0);
      expect(byClass(meter, 'claudian-todo-meter-fill')[0].style['--claudian-todo-progress']).toBe('0.25');
    });

    it('re-renders in place', () => {
      const container = createMockEl();
      renderTodoSummary(container, [todo('A', 'pending')]);
      renderTodoSummary(container, [todo('A', 'completed')]);

      expect(byClass(container, 'claudian-todo-meter')).toHaveLength(1);
      expect(byClass(container, 'claudian-todo-count')[0].textContent).toBe('1/1');
    });
  });

  describe('mountTodoCollapse', () => {
    it('turns an element into an animated collapse and keeps one body across renders', () => {
      const outer = createMockEl();

      const body = mountTodoCollapse(outer);

      expect(outer.hasClass('claudian-todo-collapse')).toBe(true);
      expect(body.hasClass('claudian-todo-collapse-inner')).toBe(true);
      expect(mountTodoCollapse(outer)).toBe(body);
      expect(outer._children).toHaveLength(1);
    });
  });
});
