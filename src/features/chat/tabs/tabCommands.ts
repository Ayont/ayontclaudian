import type { Command } from 'obsidian';

/** The chat view surface the tab commands drive. */
export interface TabCommandView {
  getOpenTabCount(): number;
  openTabOverview(): void;
  switchToAdjacentTab(delta: 1 | -1): void;
  switchToTabNumber(position: number): void;
}

export interface TabCommandHost {
  addCommand(command: Command): Command;
  getView(): TabCommandView | null;
}

/** "Chat-Tab 1…9 öffnen"; a tenth tab is reached through the overview or cycling. */
export const GO_TO_TAB_COMMAND_COUNT = 9;

export const TAB_NAVIGATION_COMMAND_IDS = [
  'open-tab-overview',
  'next-chat-tab',
  'previous-chat-tab',
  ...Array.from({ length: GO_TO_TAB_COMMAND_COUNT }, (_, index) => `open-chat-tab-${index + 1}`),
] as const;

/**
 * No default hotkeys: Obsidian already owns most Mod+digit and Ctrl+Tab
 * combinations, and a plugin default would silently shadow the user's own.
 */
export function registerTabNavigationCommands(host: TabCommandHost): void {
  host.addCommand({
    id: 'open-tab-overview',
    name: 'Tab-Übersicht öffnen',
    checkCallback: (checking) => {
      const view = host.getView();
      if (!view) return false;
      if (!checking) view.openTabOverview();
      return true;
    },
  });

  const cycle = (id: string, name: string, delta: 1 | -1): void => {
    host.addCommand({
      id,
      name,
      checkCallback: (checking) => {
        const view = host.getView();
        if (!view || view.getOpenTabCount() < 2) return false;
        if (!checking) view.switchToAdjacentTab(delta);
        return true;
      },
    });
  };
  cycle('next-chat-tab', 'Nächster Chat-Tab', 1);
  cycle('previous-chat-tab', 'Vorheriger Chat-Tab', -1);

  for (let position = 1; position <= GO_TO_TAB_COMMAND_COUNT; position++) {
    host.addCommand({
      id: `open-chat-tab-${position}`,
      name: `Chat-Tab ${position} öffnen`,
      checkCallback: (checking) => {
        const view = host.getView();
        if (!view || view.getOpenTabCount() < position) return false;
        if (!checking) view.switchToTabNumber(position);
        return true;
      },
    });
  }
}
