import { Menu, Notice, TFile, TFolder } from 'obsidian';

import type { ChatMessage } from '@/core/types';
import { EXPLAIN_SELECTION_PROMPT, registerChatIntegration } from '@/features/chat/integration/chatIntegration';
import { ChatState } from '@/features/chat/state/ChatState';
import { regenerateTabAnswer } from '@/features/chat/tabs/regenerateAnswer';

jest.mock('@/features/chat/tabs/regenerateAnswer', () => ({
  ...jest.requireActual('@/features/chat/tabs/regenerateAnswer'),
  regenerateTabAnswer: jest.fn().mockResolvedValue(undefined),
}));

const mockNotice = Notice as unknown as jest.Mock;
// The mock classes take a path; the real typings do not.
const vaultFile = (path: string): TFile => new (TFile as any)(path);
const vaultFolder = (path: string): TFolder => new (TFolder as any)(path);

function msg(id: string, role: ChatMessage['role'], content: string): ChatMessage {
  return { id, role, content, timestamp: 1 };
}

function createTab(messages: ChatMessage[] = []) {
  const state = new ChatState();
  state.messages = messages;
  return {
    state,
    dom: { inputEl: { focus: jest.fn(), value: '' } },
    ui: { fileContextManager: { attachVaultPath: jest.fn().mockReturnValue(true) } },
    controllers: {
      inputController: { cancelStreaming: jest.fn(), sendMessage: jest.fn().mockResolvedValue(undefined) },
      selectionController: { captureSelection: jest.fn() },
    },
  };
}

function createPlugin(tab: ReturnType<typeof createTab> | null) {
  const handlers: Record<string, (...args: any[]) => void> = {};
  const commands: any[] = [];
  const view = tab
    ? { getActiveTab: () => tab, whenTabsRestored: jest.fn().mockResolvedValue(undefined) }
    : null;
  const plugin = {
    app: {
      workspace: {
        on: jest.fn((name: string, handler: (...args: any[]) => void) => {
          handlers[name] = handler;
          return { name };
        }),
      },
    },
    registerEvent: jest.fn(),
    addCommand: jest.fn((command: any) => {
      commands.push(command);
      return command;
    }),
    getView: jest.fn(() => view),
    activateView: jest.fn().mockResolvedValue(undefined),
  };
  registerChatIntegration(plugin as any);
  const command = (id: string) => commands.find((entry) => entry.id === id);
  return { plugin, handlers, commands, command, view };
}

function openMenu(handler: (...args: any[]) => void, ...args: unknown[]): Menu {
  const menu = new Menu();
  handler(menu, ...args);
  return menu;
}

async function click(menu: Menu, title: string): Promise<void> {
  const item = (menu as any).items.find((entry: any) => entry.title === title);
  expect(item).toBeDefined();
  item.clickHandler();
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

function createEditor(selection: string) {
  return {
    getSelection: () => selection,
    getCursor: (which: 'from' | 'to') => (which === 'from' ? { line: 4, ch: 0 } : { line: 5, ch: 3 }),
    posToOffset: (pos: { line: number; ch: number }) => pos.line * 10 + pos.ch,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('registerChatIntegration', () => {
  it('registers both context menus and four hotkey-less German commands', () => {
    const { plugin, commands } = createPlugin(createTab());

    expect(plugin.app.workspace.on).toHaveBeenCalledWith('file-menu', expect.any(Function));
    expect(plugin.app.workspace.on).toHaveBeenCalledWith('editor-menu', expect.any(Function));
    expect(plugin.registerEvent).toHaveBeenCalledTimes(2);
    expect(commands.map((command) => command.name)).toEqual([
      'Antwort stoppen',
      'Letzte Antwort erneut generieren',
      'Chat-Eingabe fokussieren',
      'Letzte Antwort kopieren',
    ]);
    for (const command of commands) {
      expect(command.hotkeys).toBeUndefined();
      expect(typeof command.checkCallback).toBe('function');
    }
  });
});

describe('file explorer menu', () => {
  it('attaches a file to the active chat, opening the chat first', async () => {
    const tab = createTab();
    const { plugin, handlers, view } = createPlugin(tab);

    const menu = openMenu(handlers['file-menu'], vaultFile('Notes/Plan.md'), 'file-explorer');
    await click(menu, 'An Claudian anhängen');

    expect(plugin.activateView).toHaveBeenCalled();
    expect(view!.whenTabsRestored).toHaveBeenCalled();
    expect(tab.ui.fileContextManager.attachVaultPath).toHaveBeenCalledWith('Notes/Plan.md', 'file');
    expect(tab.dom.inputEl.focus).toHaveBeenCalled();
  });

  it('attaches a folder as a folder mention', async () => {
    const tab = createTab();
    const { handlers } = createPlugin(tab);

    const menu = openMenu(handlers['file-menu'], vaultFolder('Projekte/Alpha'), 'file-explorer');
    await click(menu, 'Ordner an Claudian anhängen');

    expect(tab.ui.fileContextManager.attachVaultPath).toHaveBeenCalledWith('Projekte/Alpha', 'folder');
  });

  it('offers nothing for the vault root', () => {
    const { handlers } = createPlugin(createTab());

    const menu = openMenu(handlers['file-menu'], vaultFolder('/'), 'file-explorer');

    expect((menu as any).items).toHaveLength(0);
  });

  it('says so when the path could not be attached', async () => {
    const tab = createTab();
    tab.ui.fileContextManager.attachVaultPath.mockReturnValue(false);
    const { handlers } = createPlugin(tab);

    await click(openMenu(handlers['file-menu'], vaultFile('x.md'), 'file-explorer'), 'An Claudian anhängen');

    expect(mockNotice).toHaveBeenCalledWith(expect.stringContaining('nicht an Claudian angehängt'));
    expect(tab.dom.inputEl.focus).not.toHaveBeenCalled();
  });
});

describe('editor menu', () => {
  const info = { file: vaultFile('Notes/Text.md') };

  it('offers nothing without a selection', () => {
    const { handlers } = createPlugin(createTab());

    const menu = openMenu(handlers['editor-menu'], createEditor('  '), info);

    expect((menu as any).items).toHaveLength(0);
  });

  it('hands the selection to the chat as context', async () => {
    const tab = createTab();
    const { handlers } = createPlugin(tab);

    const menu = openMenu(handlers['editor-menu'], createEditor('zwei\nZeilen'), info);
    await click(menu, 'Auswahl an Claudian senden');

    expect(tab.controllers.selectionController.captureSelection).toHaveBeenCalledWith(expect.objectContaining({
      notePath: 'Notes/Text.md',
      selectedText: 'zwei\nZeilen',
      lineCount: 2,
      startLine: 5,
    }));
    expect(tab.dom.inputEl.focus).toHaveBeenCalled();
    expect(tab.controllers.inputController.sendMessage).not.toHaveBeenCalled();
  });

  it('sends an explain prompt with the selection, leaving the composer alone', async () => {
    const tab = createTab();
    const { handlers } = createPlugin(tab);

    const menu = openMenu(handlers['editor-menu'], createEditor('Absatz'), info);
    await click(menu, 'Auswahl mit Claudian erklären');

    expect(tab.controllers.inputController.sendMessage).toHaveBeenCalledWith({
      content: EXPLAIN_SELECTION_PROMPT,
      editorContextOverride: {
        notePath: 'Notes/Text.md',
        mode: 'selection',
        selectedText: 'Absatz',
        lineCount: 1,
        startLine: 5,
      },
    });
  });
});

describe('chat commands', () => {
  it('stops only a streaming answer', () => {
    const tab = createTab();
    const { command } = createPlugin(tab);
    const stop = command('stop-answer');

    expect(stop.checkCallback(true)).toBe(false);
    tab.state.isStreaming = true;
    expect(stop.checkCallback(true)).toBe(true);
    stop.checkCallback(false);
    expect(tab.controllers.inputController.cancelStreaming).toHaveBeenCalled();
  });

  it('regenerates the last current answer when there is one', () => {
    const tab = createTab([msg('u1', 'user', 'Frage'), msg('a1', 'assistant', 'Antwort')]);
    const { command, plugin } = createPlugin(tab);
    const regenerate = command('regenerate-last-answer');

    expect(regenerate.checkCallback(true)).toBe(true);
    regenerate.checkCallback(false);
    expect(regenerateTabAnswer).toHaveBeenCalledWith(tab, plugin, 'a1');

    tab.state.isStreaming = true;
    expect(regenerate.checkCallback(true)).toBe(false);
  });

  it('is not applicable without an answer to regenerate or copy', () => {
    const { command } = createPlugin(createTab([msg('u1', 'user', 'Frage')]));

    expect(command('regenerate-last-answer').checkCallback(true)).toBe(false);
    expect(command('copy-last-answer').checkCallback(true)).toBe(false);
  });

  it('copies the text of the last answer', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    const originalNavigator = globalThis.navigator;
    Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText } }, writable: true, configurable: true });
    try {
      const tab = createTab([msg('u1', 'user', 'Frage'), msg('a1', 'assistant', '  Antwort  ')]);
      const copy = createPlugin(tab).command('copy-last-answer');

      expect(copy.checkCallback(true)).toBe(true);
      copy.checkCallback(false);
      await Promise.resolve();
      await Promise.resolve();

      expect(writeText).toHaveBeenCalledWith('Antwort');
      expect(mockNotice).toHaveBeenCalledWith('Antwort kopiert.');
    } finally {
      Object.defineProperty(globalThis, 'navigator', { value: originalNavigator, writable: true, configurable: true });
    }
  });

  it('focuses the composer, opening the chat if needed', async () => {
    const tab = createTab();
    const { command, plugin } = createPlugin(tab);
    const focus = command('focus-chat-input');

    expect(focus.checkCallback(true)).toBe(true);
    focus.checkCallback(false);
    for (let i = 0; i < 6; i++) await Promise.resolve();

    expect(plugin.activateView).toHaveBeenCalled();
    expect(tab.dom.inputEl.focus).toHaveBeenCalled();
  });

  it('stays quiet without an open chat view', () => {
    const { command } = createPlugin(null);

    expect(command('stop-answer').checkCallback(true)).toBe(false);
    expect(command('regenerate-last-answer').checkCallback(true)).toBe(false);
    expect(command('copy-last-answer').checkCallback(true)).toBe(false);
  });
});
