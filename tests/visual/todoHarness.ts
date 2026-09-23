/**
 * Mounts todo fixtures with the production renderers. components.spec.ts
 * bundles this file (obsidian → obsidianShim) and injects it into
 * components.html, so the screenshots show exactly what StatusPanel and the
 * TodoWrite card render — no hand-copied markup to drift.
 */
import type { TodoItem } from '../../src/core/tools/todo';
import type { ToolCallInfo } from '../../src/core/types';
import { renderStoredToolCall, updateToolCallResult } from '../../src/features/chat/rendering/ToolCallRenderer';
import { StatusPanel } from '../../src/features/chat/ui/StatusPanel';

type Status = TodoItem['status'];

function item(content: string, status: Status, extra: Partial<TodoItem> = {}): TodoItem {
  return { activeForm: content, content, status, ...extra };
}

const MIXED: TodoItem[] = [
  item('Anforderungen aus dem Ticket zusammenfassen', 'completed'),
  item('Bestehende Provider-Normalisierung lesen', 'completed'),
  item('ACP-Plan-Updates als TodoWrite abbilden', 'in_progress', {
    activeForm: 'Bilde ACP-Plan-Updates als TodoWrite ab',
  }),
  item('Tests für alle Provider ergänzen', 'pending'),
  item('Visuelle Regression aufnehmen', 'pending'),
];

const MANY: TodoItem[] = [
  item('Recon: dsh-headless verifizieren', 'completed'),
  item('Referenz-Provider lesen', 'completed'),
  item('Provider-Gerüst anlegen', 'completed'),
  item('Parser-Tests mit echten Mitschnitten', 'pending'),
  item('Registrierung und Icons', 'completed'),
  item('Brand-Farben und Statusleiste', 'completed'),
  item('Installationskatalog und Locales', 'pending'),
  item('Performance-Pass', 'in_progress', { activeForm: 'Messe Hotspots beim Start' }),
  item('Design-Pass für den Chat', 'pending'),
  item('Typecheck', 'pending'),
  item('Lint ohne Fehler', 'pending'),
  item('Build und Release-Notiz', 'pending'),
];

const DONE: TodoItem[] = [
  item('Schema migrieren', 'completed'),
  item('Backfill ausführen', 'completed'),
  item('Alte Spalten entfernen', 'completed'),
  item('Changelog schreiben', 'completed'),
];

const LONG: TodoItem[] = [
  item('Sitzungsdatenbank ins neue Schema migrieren', 'completed', { priority: 'high' }),
  item(
    'Migriere die Sitzungsdatenbank und prüfe dabei, dass keine Unterhaltung mit mehr als 500 Nachrichten beim Laden abgeschnitten wird',
    'in_progress',
    {
      activeForm: 'Prüfe, dass keine Unterhaltung mit mehr als 500 Nachrichten beim Laden der Sitzungsdatenbank abgeschnitten wird',
      priority: 'high',
    },
  ),
  item('src/providers/acp/AcpSessionUpdateNormalizer.ts→AcpPlanTodoBridge.ts', 'pending', { priority: 'medium' }),
  item('Aufräumen', 'pending', { priority: 'low' }),
  item('Release-Notiz für die neue Aufgabenliste formulieren und mit Screenshots aus hellem und dunklem Theme belegen', 'pending'),
];

const FIXTURES: Record<string, TodoItem[]> = { done: DONE, long: LONG, many: MANY, mixed: MIXED };

function todoCall(id: string, todos: TodoItem[]): ToolCallInfo {
  return { id, input: { todos }, name: 'TodoWrite', status: 'completed' };
}

function openGroup(root: HTMLElement): void {
  root.querySelector<HTMLElement>('.claudian-todo-group-toggle')?.click();
}

function mount(host: HTMLElement): void {
  const todos = FIXTURES[host.dataset.todoFixture ?? ''] ?? [];
  const expanded = host.dataset.expanded === 'true';
  const groupOpen = host.dataset.groupOpen === 'true';

  if (host.dataset.surface === 'panel') {
    const panel = new StatusPanel();
    panel.mount(host);
    panel.updateTodos(todos);
    if (expanded) {
      host.querySelector<HTMLElement>('.claudian-todo-header')?.click();
    }
    if (groupOpen) {
      openGroup(host);
      // The next plan update re-renders; the list keeps the running task in view.
      panel.updateTodos(todos);
    }
    return;
  }

  const call = todoCall(`todo-${host.dataset.todoFixture}`, todos);
  const card = renderStoredToolCall(host, call, { initiallyExpanded: expanded });
  if (groupOpen) {
    openGroup(card);
    updateToolCallResult(call.id, call, new Map([[call.id, card]]));
  }
}

(window as unknown as { __mountTodoFixtures: () => void }).__mountTodoFixtures = () => {
  document.querySelectorAll<HTMLElement>('[data-todo-fixture]').forEach(mount);
};
