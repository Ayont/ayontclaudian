import {
  GO_TO_TAB_COMMAND_COUNT,
  registerTabNavigationCommands,
  TAB_NAVIGATION_COMMAND_IDS,
  type TabCommandView,
} from '@/features/chat/tabs/tabCommands';

type RegisteredCommand = {
  id: string;
  name: string;
  hotkeys?: unknown[];
  checkCallback?: (checking: boolean) => boolean | void;
};

function createHost(view: TabCommandView | null) {
  const commands: RegisteredCommand[] = [];
  const host = {
    addCommand: jest.fn((command: RegisteredCommand) => {
      commands.push(command);
      return command;
    }),
    getView: jest.fn(() => view),
  };
  registerTabNavigationCommands(host as never);
  const byId = (id: string) => commands.find((command) => command.id === id)!;
  return { byId, commands };
}

function createView(tabCount: number): jest.Mocked<TabCommandView> {
  return {
    getOpenTabCount: jest.fn(() => tabCount),
    openTabOverview: jest.fn(),
    switchToAdjacentTab: jest.fn(),
    switchToTabNumber: jest.fn(),
  };
}

describe('registerTabNavigationCommands', () => {
  it('registers German-named commands without default hotkeys', () => {
    const { commands } = createHost(createView(3));

    expect(commands.map((command) => command.name)).toEqual([
      'Tab-Übersicht öffnen',
      'Nächster Chat-Tab',
      'Vorheriger Chat-Tab',
      ...Array.from({ length: GO_TO_TAB_COMMAND_COUNT }, (_, index) => `Chat-Tab ${index + 1} öffnen`),
    ]);
    expect(commands.every((command) => command.hotkeys === undefined)).toBe(true);
    expect(commands.map((command) => command.id)).toEqual([...TAB_NAVIGATION_COMMAND_IDS]);
  });

  it('opens the overview whenever a chat view exists', () => {
    const view = createView(1);
    const { byId } = createHost(view);

    expect(byId('open-tab-overview').checkCallback?.(true)).toBe(true);
    byId('open-tab-overview').checkCallback?.(false);
    expect(view.openTabOverview).toHaveBeenCalled();
    expect(createHost(null).byId('open-tab-overview').checkCallback?.(true)).toBe(false);
  });

  it('cycles tabs only when there is somewhere to go', () => {
    const single = createHost(createView(1));
    expect(single.byId('next-chat-tab').checkCallback?.(true)).toBe(false);

    const view = createView(3);
    const { byId } = createHost(view);
    byId('next-chat-tab').checkCallback?.(false);
    byId('previous-chat-tab').checkCallback?.(false);
    expect(view.switchToAdjacentTab.mock.calls).toEqual([[1], [-1]]);
  });

  it('offers "Chat-Tab N öffnen" only for tabs that exist', () => {
    const view = createView(3);
    const { byId } = createHost(view);

    expect(byId('open-chat-tab-3').checkCallback?.(true)).toBe(true);
    expect(byId('open-chat-tab-4').checkCallback?.(true)).toBe(false);
    byId('open-chat-tab-2').checkCallback?.(false);
    expect(view.switchToTabNumber).toHaveBeenCalledWith(2);
  });
});
