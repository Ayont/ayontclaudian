/**
 * Obsidian-side entry points into the chat: file explorer and editor context
 * menus, plus chat commands for the command palette. Everything here acts on
 * the active chat tab and reuses the tab's own send, selection and mention
 * paths instead of reimplementing them.
 */

import type { Editor, MarkdownFileInfo, MarkdownView, Menu, TAbstractFile } from 'obsidian';
import { Notice, TFile, TFolder } from 'obsidian';

import type ClaudianPlugin from '../../../main';
import type { EditorSelectionContext } from '../../../utils/editor';
import { readEditorSelection } from '../controllers/SelectionController';
import type { StoredSelection } from '../state/types';
import { findLastAnswerId, planRegeneration, regenerateTabAnswer } from '../tabs/regenerateAnswer';
import type { TabData } from '../tabs/types';
import { assistantMessageText } from '../utils/messageText';

export const EXPLAIN_SELECTION_PROMPT = 'Erkläre mir diese Auswahl.';

/** Opens (or reveals) the chat and returns its active tab once the restore has run. */
async function openActiveChatTab(plugin: ClaudianPlugin): Promise<TabData | null> {
  await plugin.activateView();
  const view = plugin.getView();
  if (!view) return null;
  await view.whenTabsRestored();
  return view.getActiveTab();
}

function activeChatTab(plugin: ClaudianPlugin): TabData | null {
  return plugin.getView()?.getActiveTab() ?? null;
}

function runChatAction(action: () => Promise<void>): void {
  void action().catch((error: unknown) => {
    new Notice(`Claudian: ${error instanceof Error ? error.message : String(error)}`);
  });
}

async function attachToChat(plugin: ClaudianPlugin, file: TAbstractFile, kind: 'file' | 'folder'): Promise<void> {
  const tab = await openActiveChatTab(plugin);
  const fileContext = tab?.ui.fileContextManager;
  if (!tab || !fileContext) return;
  if (!fileContext.attachVaultPath(file.path, kind)) {
    new Notice(`„${file.name}“ konnte nicht an Claudian angehängt werden.`);
    return;
  }
  tab.dom.inputEl.focus();
}

function addFileMenuItems(plugin: ClaudianPlugin, menu: Menu, file: TAbstractFile): void {
  if (file instanceof TFile) {
    menu.addItem((item) => item
      .setTitle('An Claudian anhängen')
      .setIcon('paperclip')
      .onClick(() => runChatAction(() => attachToChat(plugin, file, 'file'))));
    return;
  }
  const isVaultRoot = !file.path || file.path === '/';
  if (file instanceof TFolder && !isVaultRoot) {
    menu.addItem((item) => item
      .setTitle('Ordner an Claudian anhängen')
      .setIcon('folder-plus')
      .onClick(() => runChatAction(() => attachToChat(plugin, file, 'folder'))));
  }
}

function toEditorContext(selection: StoredSelection): EditorSelectionContext {
  return {
    notePath: selection.notePath,
    mode: 'selection',
    selectedText: selection.selectedText,
    lineCount: selection.lineCount,
    ...(selection.startLine !== undefined ? { startLine: selection.startLine } : {}),
  };
}

async function addSelectionAsContext(plugin: ClaudianPlugin, selection: StoredSelection): Promise<void> {
  const tab = await openActiveChatTab(plugin);
  if (!tab?.controllers.selectionController) return;
  tab.controllers.selectionController.captureSelection(selection);
  tab.dom.inputEl.focus();
}

async function explainSelection(plugin: ClaudianPlugin, selection: StoredSelection): Promise<void> {
  const tab = await openActiveChatTab(plugin);
  // A programmatic send leaves the draft alone; a running answer queues it.
  await tab?.controllers.inputController?.sendMessage({
    content: EXPLAIN_SELECTION_PROMPT,
    editorContextOverride: toEditorContext(selection),
  });
}

function addEditorMenuItems(
  plugin: ClaudianPlugin,
  menu: Menu,
  editor: Editor,
  info: MarkdownView | MarkdownFileInfo,
): void {
  // Read now: once the chat takes focus the editor is no longer the active view.
  const selection = readEditorSelection(editor, info.file?.path ?? 'unknown');
  if (!selection) return;
  menu.addItem((item) => item
    .setTitle('Auswahl an Claudian senden')
    .setIcon('message-square-plus')
    .onClick(() => runChatAction(() => addSelectionAsContext(plugin, selection))));
  menu.addItem((item) => item
    .setTitle('Auswahl mit Claudian erklären')
    .setIcon('sparkles')
    .onClick(() => runChatAction(() => explainSelection(plugin, selection))));
}

function lastAnswerText(tab: TabData): string {
  const messages = tab.state.messages;
  const id = findLastAnswerId(messages, { isStreaming: tab.state.isStreaming });
  const answer = id ? messages.find((message) => message.id === id) : undefined;
  return answer ? assistantMessageText(answer) : '';
}

async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    new Notice('Antwort kopiert.');
  } catch {
    new Notice('Antwort konnte nicht kopiert werden.');
  }
}

function registerChatCommands(plugin: ClaudianPlugin): void {
  plugin.addCommand({
    id: 'stop-answer',
    name: 'Antwort stoppen',
    checkCallback: (checking) => {
      const tab = activeChatTab(plugin);
      const inputController = tab?.controllers.inputController;
      if (!tab?.state.isStreaming || !inputController) return false;
      if (!checking) inputController.cancelStreaming();
      return true;
    },
  });

  plugin.addCommand({
    id: 'regenerate-last-answer',
    name: 'Letzte Antwort erneut generieren',
    checkCallback: (checking) => {
      const tab = activeChatTab(plugin);
      if (!tab || tab.state.isStreaming) return false;
      const messages = tab.state.messages;
      const answerId = findLastAnswerId(messages, { isStreaming: false });
      if (!answerId || !planRegeneration(messages, answerId, { canRewind: false }).ok) return false;
      if (!checking) void regenerateTabAnswer(tab, plugin, answerId);
      return true;
    },
  });

  plugin.addCommand({
    id: 'focus-chat-input',
    name: 'Chat-Eingabe fokussieren',
    checkCallback: (checking) => {
      if (!checking) {
        runChatAction(async () => {
          (await openActiveChatTab(plugin))?.dom.inputEl.focus();
        });
      }
      return true;
    },
  });

  plugin.addCommand({
    id: 'copy-last-answer',
    name: 'Letzte Antwort kopieren',
    checkCallback: (checking) => {
      const tab = activeChatTab(plugin);
      const text = tab ? lastAnswerText(tab) : '';
      if (!text) return false;
      if (!checking) void copyToClipboard(text);
      return true;
    },
  });
}

export function registerChatIntegration(plugin: ClaudianPlugin): void {
  plugin.registerEvent(plugin.app.workspace.on('file-menu', (menu, file) => {
    addFileMenuItems(plugin, menu, file);
  }));
  plugin.registerEvent(plugin.app.workspace.on('editor-menu', (menu, editor, info) => {
    addEditorMenuItems(plugin, menu, editor, info);
  }));
  registerChatCommands(plugin);
}
