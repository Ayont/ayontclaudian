# Kimi Code CLI Phase 1 — Slash Commands & Session Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface and execute every Kimi Code CLI slash command inside Claudian: `/new`, `/fork`, `/sessions`, `/model`, `/help`, `/exit`, `/compact`, `/undo`, `/usage`, `/status`, plus existing `/goal`, `/skill:*`, `/plan`, `/swarm`, `/tasks`.

**Architecture:** Add a `KimiSlashCommandHandler` that intercepts known slash commands before `KimiChatRuntime.query()` spawns the CLI. UI-heavy commands (`/sessions`, `/help`, `/model`, `/exit`) open native Obsidian modals or call tab controllers. Session mutating commands (`/new`, `/fork`) update `KimiProviderState`. Pass-through commands (`/compact`, `/undo`, `/usage`, `/status`) are forwarded to `kimi` unchanged.

**Tech Stack:** TypeScript, Obsidian API (`Modal`, `Notice`), Node `child_process`, Jest, existing `KimiChatRuntime`, `KimiSessionStore`, `SharedVaultCommandCatalog`.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/providers/kimi/commands/KimiSlashCommandHandler.ts` | Parse and dispatch slash commands; returns whether command was consumed and optional follow-up prompt. |
| `src/providers/kimi/commands/KimiSessionListModal.ts` | Obsidian modal listing on-disk Kimi sessions; emits selection event. |
| `src/providers/kimi/commands/KimiHelpModal.ts` | Obsidian modal showing slash-command reference. |
| `src/providers/kimi/commands/kimiStaticCommands.ts` | Static `ProviderCommandEntry[]` for all Kimi slash commands (separate from vault entries). |
| `src/providers/kimi/types.ts` | `KimiProviderState` + helpers; add `forkParentId`. |
| `src/providers/kimi/runtime/KimiChatRuntime.ts` | Detect slash commands and delegate to handler before building launch spec. |
| `src/providers/kimi/app/KimiWorkspaceServices.ts` | Wire static command list into `SharedVaultCommandCatalog`. |
| `tests/unit/providers/kimi/commands/KimiSlashCommandHandler.test.ts` | Unit tests for handler dispatch and state changes. |
| `tests/unit/providers/kimi/commands/KimiSessionListModal.test.ts` | Unit tests for session list data extraction. |

---

## Task 1: Extend `KimiProviderState` for fork tracking

**Files:**
- Modify: `src/providers/kimi/types.ts`
- Test: `tests/unit/providers/kimi/types.test.ts` (add assertions)

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/providers/kimi/types.test.ts
import { getKimiState, buildPersistedKimiState } from '@/providers/kimi/types';

describe('KimiProviderState', () => {
  it('round-trips forkParentId', () => {
    const state = getKimiState({ sessionId: 's1', goal: 'g', forkParentId: 's0' });
    expect(state.forkParentId).toBe('s0');
    const persisted = buildPersistedKimiState(state);
    expect(persisted).toEqual({ sessionId: 's1', goal: 'g', forkParentId: 's0' });
  });

  it('ignores empty forkParentId', () => {
    const state = getKimiState({ sessionId: 's1', forkParentId: '  ' });
    expect(state.forkParentId).toBeUndefined();
    const persisted = buildPersistedKimiState(state);
    expect(persisted).toEqual({ sessionId: 's1' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --selectProjects unit tests/unit/providers/kimi/types.test.ts`
Expected: FAIL with `forkParentId` property/type errors.

- [ ] **Step 3: Implement the type change**

```ts
// src/providers/kimi/types.ts
export interface KimiProviderState {
  sessionId?: string;
  goal?: string;
  forkParentId?: string;
}

export function getKimiState(providerState?: Record<string, unknown>): KimiProviderState {
  if (!providerState || typeof providerState !== 'object' || Array.isArray(providerState)) {
    return {};
  }
  const record = providerState as Record<string, unknown>;
  const state: KimiProviderState = {};
  if (typeof record.sessionId === 'string' && record.sessionId.trim()) {
    state.sessionId = record.sessionId.trim();
  }
  if (typeof record.goal === 'string' && record.goal.trim()) {
    state.goal = record.goal.trim();
  }
  if (typeof record.forkParentId === 'string' && record.forkParentId.trim()) {
    state.forkParentId = record.forkParentId.trim();
  }
  return state;
}

export function buildPersistedKimiState(
  state: KimiProviderState,
): Record<string, unknown> | undefined {
  const entries: Record<string, unknown> = {};
  if (state.sessionId) {
    entries.sessionId = state.sessionId;
  }
  if (state.goal) {
    entries.goal = state.goal;
  }
  if (state.forkParentId) {
    entries.forkParentId = state.forkParentId;
  }
  return Object.keys(entries).length > 0 ? entries : undefined;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- --selectProjects unit tests/unit/providers/kimi/types.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/providers/kimi/types.ts tests/unit/providers/kimi/types.test.ts
git commit -m "feat(kimi): add forkParentId to provider state"
```

---

## Task 2: Create `KimiSlashCommandHandler`

**Files:**
- Create: `src/providers/kimi/commands/KimiSlashCommandHandler.ts`
- Test: `tests/unit/providers/kimi/commands/KimiSlashCommandHandler.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/providers/kimi/commands/KimiSlashCommandHandler.test.ts
import { KimiSlashCommandHandler } from '@/providers/kimi/commands/KimiSlashCommandHandler';
import type { KimiProviderState } from '@/providers/kimi/types';

function makeHandler() {
  const state: KimiProviderState = { sessionId: 's1', goal: 'test goal' };
  const updates: KimiProviderState[] = [];
  const opened: string[] = [];
  const closed: boolean[] = [];
  const followUps: (string | undefined)[] = [];
  const handler = new KimiSlashCommandHandler(
    () => state,
    (u) => updates.push(u),
    { openSessionList: () => opened.push('sessions'), openModelPicker: () => opened.push('model'), openHelp: () => opened.push('help'), closeTab: () => closed.push(true) },
    (p) => followUps.push(p),
  );
  return { handler, state, updates, opened, closed, followUps };
}

describe('KimiSlashCommandHandler', () => {
  it('consumes /new and clears state', async () => {
    const { handler, updates, followUps } = makeHandler();
    const result = await handler.execute('/new');
    expect(result.consumed).toBe(true);
    expect(updates).toEqual([{ sessionId: undefined, goal: undefined, forkParentId: undefined }]);
    expect(followUps).toEqual(['Starting a new Kimi session.']);
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

  it('passes through /compact', async () => {
    const { handler, updates } = makeHandler();
    const result = await handler.execute('/compact');
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --selectProjects unit tests/unit/providers/kimi/commands/KimiSlashCommandHandler.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the handler**

```ts
// src/providers/kimi/commands/KimiSlashCommandHandler.ts
import type { KimiProviderState } from '../types';

export interface KimiSlashCommandUI {
  openSessionList(): void;
  openModelPicker(): void;
  openHelp(): void;
  closeTab(): void;
}

export interface KimiSlashCommandResult {
  consumed: boolean;
  followUpPrompt?: string;
}

const SLASH_RE = /^\/([a-zA-Z0-9_-]+)(?::(\S+))?(?:\s+(.*))?$/;

export class KimiSlashCommandHandler {
  constructor(
    private readonly getState: () => KimiProviderState,
    private readonly updateState: (state: KimiProviderState) => void,
    private readonly ui: KimiSlashCommandUI,
    private readonly followUp: (prompt: string) => void,
  ) {}

  async execute(input: string): Promise<KimiSlashCommandResult> {
    const match = input.match(SLASH_RE);
    if (!match) {
      return { consumed: false };
    }
    const [, name, skillName, args] = match;
    const rest = skillName !== undefined ? `:${skillName}${args ? ` ${args}` : ''}` : args ?? '';

    switch (name.toLowerCase()) {
      case 'new':
        this.updateState({ sessionId: undefined, goal: undefined, forkParentId: undefined });
        this.followUp('Starting a new Kimi session.');
        return { consumed: true };

      case 'fork': {
        const parentId = this.getState().sessionId;
        if (!parentId) {
          this.followUp('No active session to fork. Start a session first.');
          return { consumed: true };
        }
        this.updateState({ sessionId: undefined, forkParentId: parentId });
        this.followUp(`Forked from session ${parentId}. Starting a fresh branch.`);
        return { consumed: true };
      }

      case 'sessions':
        this.ui.openSessionList();
        return { consumed: true };

      case 'model':
        this.ui.openModelPicker();
        return { consumed: true };

      case 'help':
        this.ui.openHelp();
        return { consumed: true };

      case 'exit':
        this.ui.closeTab();
        return { consumed: true };

      case 'goal':
      case 'skill':
      case 'plan':
      case 'swarm':
      case 'tasks':
      case 'compact':
      case 'undo':
      case 'usage':
      case 'status':
        // Pass through to Kimi CLI; these are already surfaced in the dropdown.
        return { consumed: false };

      default:
        return { consumed: false };
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- --selectProjects unit tests/unit/providers/kimi/commands/KimiSlashCommandHandler.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/providers/kimi/commands/KimiSlashCommandHandler.ts tests/unit/providers/kimi/commands/KimiSlashCommandHandler.test.ts
git commit -m "feat(kimi): add slash command handler for /new /fork /sessions /model /help /exit"
```

---

## Task 3: Create `KimiSessionListModal`

**Files:**
- Create: `src/providers/kimi/commands/KimiSessionListModal.ts`
- Test: `tests/unit/providers/kimi/commands/KimiSessionListModal.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/providers/kimi/commands/KimiSessionListModal.test.ts
import { buildKimiSessionRows } from '@/providers/kimi/commands/KimiSessionListModal';

jest.mock('node:fs', () => ({
  readdirSync: jest.fn(),
  statSync: jest.fn(),
}));

import * as fs from 'node:fs';

describe('buildKimiSessionRows', () => {
  it('returns sessions sorted by mtime desc', () => {
    (fs.readdirSync as jest.Mock).mockReturnValue(['s1', 's2']);
    (fs.statSync as jest.Mock).mockImplementation((p: string) => {
      if (p.includes('s1')) return { isDirectory: () => true, mtimeMs: 200 };
      if (p.includes('s2')) return { isDirectory: () => true, mtimeMs: 100 };
      throw new Error('unknown');
    });

    const rows = buildKimiSessionRows();
    expect(rows.map((r) => r.id)).toEqual(['s1', 's2']);
  });

  it('returns empty array when sessions dir missing', () => {
    (fs.readdirSync as jest.Mock).mockImplementation(() => { throw new Error('enoent'); });
    expect(buildKimiSessionRows()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --selectProjects unit tests/unit/providers/kimi/commands/KimiSessionListModal.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the modal helper and modal class**

```ts
// src/providers/kimi/commands/KimiSessionListModal.ts
import { App, Modal } from 'obsidian';
import * as fs from 'node:fs';
import { listKimiSessionIds } from '../history/KimiSessionStore';

export interface KimiSessionRow {
  id: string;
  label: string;
  mtimeMs: number;
}

export function buildKimiSessionRows(): KimiSessionRow[] {
  const ids = listKimiSessionIds();
  return ids.map((id) => ({ id, label: id, mtimeMs: 0 }));
}

export class KimiSessionListModal extends Modal {
  private selectedId: string | null = null;

  constructor(
    app: App,
    private readonly onSelect: (id: string) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h2', { text: 'Resume Kimi session' });

    const rows = buildKimiSessionRows();
    if (rows.length === 0) {
      contentEl.createEl('p', { text: 'No Kimi sessions found.' });
      return;
    }

    const list = contentEl.createEl('div', { cls: 'kimi-session-list' });
    for (const row of rows) {
      const item = list.createEl('div', { cls: 'kimi-session-list-item' });
      item.createEl('span', { text: row.label });
      item.addEventListener('click', () => {
        this.selectedId = row.id;
        this.close();
      });
    }
  }

  onClose(): void {
    if (this.selectedId) {
      this.onSelect(this.selectedId);
    }
    this.contentEl.empty();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- --selectProjects unit tests/unit/providers/kimi/commands/KimiSessionListModal.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/providers/kimi/commands/KimiSessionListModal.ts tests/unit/providers/kimi/commands/KimiSessionListModal.test.ts
git commit -m "feat(kimi): add session list modal for /sessions"
```

---

## Task 4: Create `KimiHelpModal`

**Files:**
- Create: `src/providers/kimi/commands/KimiHelpModal.ts`

- [ ] **Step 1: Implement the modal**

```ts
// src/providers/kimi/commands/KimiHelpModal.ts
import { App, Modal } from 'obsidian';

const COMMANDS: Array<{ name: string; description: string }> = [
  { name: '/new', description: 'Start a new Kimi session' },
  { name: '/fork', description: 'Fork the current session' },
  { name: '/sessions', description: 'Browse and resume Kimi sessions' },
  { name: '/model', description: 'Switch the current model' },
  { name: '/goal', description: 'Set a standing goal' },
  { name: '/skill:<name>', description: 'Invoke a Kimi skill' },
  { name: '/plan', description: 'Enter plan mode' },
  { name: '/swarm', description: 'Start a Kimi agent swarm' },
  { name: '/tasks', description: 'Show background tasks' },
  { name: '/compact', description: 'Compress context' },
  { name: '/undo', description: 'Undo the last turn' },
  { name: '/usage', description: 'Show quota usage' },
  { name: '/status', description: 'Show Kimi status' },
  { name: '/help', description: 'Show this help' },
  { name: '/exit', description: 'Close the current tab' },
];

export class KimiHelpModal extends Modal {
  constructor(app: App) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h2', { text: 'Kimi Code CLI Commands' });
    const list = contentEl.createEl('div', { cls: 'kimi-help-list' });
    for (const cmd of COMMANDS) {
      const row = list.createEl('div', { cls: 'kimi-help-row' });
      row.createEl('code', { text: cmd.name });
      row.createEl('span', { text: cmd.description });
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
```

- [ ] **Step 2: Add minimal CSS**

Add to `src/styles.css` or an existing CSS file:

```css
.kimi-help-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
}

.kimi-help-row {
  display: flex;
  gap: 12px;
  align-items: baseline;
}

.kimi-session-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 12px;
}

.kimi-session-list-item {
  padding: 8px;
  border-radius: 4px;
  cursor: pointer;
}

.kimi-session-list-item:hover {
  background: var(--background-modifier-hover);
}
```

- [ ] **Step 3: Commit**

```bash
git add src/providers/kimi/commands/KimiHelpModal.ts src/styles.css
git commit -m "feat(kimi): add help modal for /help"
```

---

## Task 5: Extract static command list into `kimiStaticCommands.ts`

**Files:**
- Create: `src/providers/kimi/commands/kimiStaticCommands.ts`
- Modify: `src/providers/kimi/app/KimiWorkspaceServices.ts`

- [ ] **Step 1: Move static entries to new file**

```ts
// src/providers/kimi/commands/kimiStaticCommands.ts
import type { ProviderCommandEntry } from '../../../core/providers/commands/ProviderCommandEntry';

function cmd(
  id: string,
  name: string,
  description: string,
  content: string,
  argumentHint?: string,
): ProviderCommandEntry {
  return {
    id: `kimi:${id}`,
    providerId: 'kimi',
    kind: 'command',
    name,
    description,
    content,
    argumentHint,
    scope: 'builtin',
    source: 'builtin',
    isEditable: false,
    isDeletable: false,
    displayPrefix: '/',
    insertPrefix: '/',
  };
}

export const KIMI_STATIC_COMMANDS: ProviderCommandEntry[] = [
  cmd('goal', 'goal', 'Set a standing goal for this session', '/goal $ARGUMENTS', '[goal text]'),
  cmd('skill', 'skill', 'Invoke a Kimi skill (e.g. frontend-design)', '/skill:$ARGUMENTS', '[skill-name] [args]'),
  cmd('new', 'new', 'Start a new Kimi session', '/new'),
  cmd('fork', 'fork', 'Fork the current session', '/fork'),
  cmd('sessions', 'sessions', 'Browse and resume Kimi sessions', '/sessions'),
  cmd('model', 'model', 'Switch the current model', '/model'),
  cmd('plan', 'plan', 'Enter plan mode', '/plan'),
  cmd('swarm', 'swarm', 'Start a Kimi agent swarm', '/swarm $ARGUMENTS', '[task]'),
  cmd('tasks', 'tasks', 'Show background tasks', '/tasks'),
  cmd('usage', 'usage', 'Show token/quota usage', '/usage'),
  cmd('status', 'status', 'Show Kimi runtime status', '/status'),
  cmd('compact', 'compact', 'Compact the conversation context', '/compact'),
  cmd('undo', 'undo', 'Undo the last turn', '/undo'),
  cmd('help', 'help', 'Show Kimi slash command help', '/help'),
  cmd('exit', 'exit', 'Close the current chat tab', '/exit'),
];
```

- [ ] **Step 2: Update `KimiWorkspaceServices.ts` to import the list**

```ts
// src/providers/kimi/app/KimiWorkspaceServices.ts
import { KIMI_STATIC_COMMANDS } from '../commands/kimiStaticCommands';
// ... remove the inline KIMI_STATIC_COMMANDS const ...
```

Replace the inline const assignment with the import.

- [ ] **Step 3: Commit**

```bash
git add src/providers/kimi/commands/kimiStaticCommands.ts src/providers/kimi/app/KimiWorkspaceServices.ts
git commit -m "refactor(kimi): extract static slash commands to dedicated module"
```

---

## Task 6: Wire slash-command handler into `KimiChatRuntime`

**Files:**
- Modify: `src/providers/kimi/runtime/KimiChatRuntime.ts`

- [ ] **Step 1: Add imports and handler construction**

```ts
// src/providers/kimi/runtime/KimiChatRuntime.ts
import { KimiSessionListModal } from '../commands/KimiSessionListModal';
import { KimiHelpModal } from '../commands/KimiHelpModal';
import { KimiSlashCommandHandler } from '../commands/KimiSlashCommandHandler';
```

Add handler field and UI adapter:

```ts
export class KimiChatRuntime implements ChatRuntime {
  // ... existing fields ...
  private slashHandler: KimiSlashCommandHandler;

  constructor(private readonly plugin: ClaudianPlugin) {
    this.slashHandler = new KimiSlashCommandHandler(
      () => ({ sessionId: this.sessionId ?? undefined, goal: this.goal ?? undefined }),
      (state) => {
        this.sessionId = state.sessionId ?? null;
        this.goal = state.goal ?? null;
        this.sessionInvalidated = false;
      },
      {
        openSessionList: () => new KimiSessionListModal(this.plugin.app, (id) => {
          this.sessionId = id;
          this.sessionInvalidated = false;
          // Trigger a follow-up turn to load the session.
          // Actual wiring depends on Tab controller; see Task 7.
        }).open(),
        openModelPicker: () => {
          // Dispatch custom event or call existing UI controller; see Task 7.
        },
        openHelp: () => new KimiHelpModal(this.plugin.app).open(),
        closeTab: () => {
          // Close current tab via TabManager; see Task 7.
        },
      },
      (prompt) => {
        // Send follow-up prompt; see Task 7.
      },
    );
  }
```

- [ ] **Step 2: Intercept slash commands in `query()`**

After the `prepareKimiPromptWithGoal` call (line ~194), add:

```ts
const slashResult = await this.slashHandler.execute(promptText);
if (slashResult.consumed) {
  if (slashResult.followUpPrompt) {
    yield { type: 'assistant', content: slashResult.followUpPrompt };
  }
  yield { type: 'done' };
  return;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/providers/kimi/runtime/KimiChatRuntime.ts
git commit -m "feat(kimi): wire slash command handler into runtime"
```

---

## Task 7: Connect UI callbacks to real controllers

**Files:**
- Modify: `src/providers/kimi/runtime/KimiChatRuntime.ts`
- Modify: `src/features/chat/tabs/Tab.ts` or relevant controller

- [ ] **Step 1: Find tab close mechanism**

Search the codebase for how tabs are closed (likely `TabManager.closeTab(tabId)`).

- [ ] **Step 2: Implement `closeTab` callback**

```ts
closeTab: () => {
  const tabId = this.plugin.tabManager?.getActiveTabId?.();
  if (tabId) {
    this.plugin.tabManager.closeTab(tabId);
  }
}
```

Use actual `TabManager` API discovered in Step 1.

- [ ] **Step 3: Implement model picker callback**

Reuse the existing model dropdown command. If a global event exists, dispatch it:

```ts
openModelPicker: () => {
  document.dispatchEvent(new CustomEvent('claudian:open-model-picker', { detail: { providerId: 'kimi' } }));
}
```

Or call the existing toolbar controller method if available.

- [ ] **Step 4: Implement session resume callback**

When a session is selected in the modal, reload the tab's conversation history:

```ts
openSessionList: () => new KimiSessionListModal(this.plugin.app, (id) => {
  this.sessionId = id;
  this.sessionInvalidated = false;
  document.dispatchEvent(new CustomEvent('claudian:reload-conversation', { detail: { providerId: 'kimi' } }));
}).open()
```

- [ ] **Step 5: Commit**

```bash
git add src/providers/kimi/runtime/KimiChatRuntime.ts
git commit -m "feat(kimi): connect slash command UI callbacks to tab controllers"
```

---

## Task 8: Ensure pass-through commands reach Kimi unchanged

**Files:**
- Modify: `src/providers/kimi/commands/KimiSlashCommandHandler.ts`
- Test: `tests/unit/providers/kimi/commands/KimiSlashCommandHandler.test.ts`

- [ ] **Step 1: Add explicit pass-through tests**

```ts
it.each(['/compact', '/undo', '/usage', '/status', '/plan', '/swarm test', '/tasks'])('passes through %s', async (input) => {
  const { handler, updates } = makeHandler();
  const result = await handler.execute(input);
  expect(result.consumed).toBe(false);
  expect(updates).toHaveLength(0);
});
```

- [ ] **Step 2: Run tests**

Run: `npm run test -- --selectProjects unit tests/unit/providers/kimi/commands/KimiSlashCommandHandler.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/providers/kimi/commands/KimiSlashCommandHandler.test.ts
git commit -m "test(kimi): verify pass-through slash commands"
```

---

## Task 9: Full verification

- [ ] **Step 1: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: no errors (warnings ok).

- [ ] **Step 3: Unit tests**

Run: `npm run test -- --selectProjects unit`
Expected: all pass.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: produces `main.js` and `styles.css`.

- [ ] **Step 5: Deploy**

```bash
cp main.js styles.css manifest.json /Users/ayont/Documents/Obsidian\ Vault/.obsidian/plugins/realclaudian/
```

- [ ] **Step 6: Commit final changes**

```bash
git add -A
git commit -m "feat(kimi): Phase 1 slash commands and session management"
```

---

## Self-Review Checklist

- [ ] Spec coverage: every Phase 1 command has a task.
- [ ] Placeholder scan: no TBD/TODO/"fill in" left.
- [ ] Type consistency: `KimiProviderState`, handler UI interface, and runtime field names align.
- [ ] Tests: new modules have unit tests; existing suite still passes.
