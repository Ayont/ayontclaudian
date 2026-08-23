import * as fs from 'fs';

import { updateHermesDiscoveryState } from '@/providers/hermes/discoveryState';
import { getHermesProviderSettings } from '@/providers/hermes/settings';
import { hermesSettingsTabRenderer } from '@/providers/hermes/ui/HermesSettingsTab';

const mockGetHostnameKey = jest.fn(() => 'host-a');
const mockRenderEnvironmentSettingsSection = jest.fn();
const mockSaveSettings = jest.fn().mockResolvedValue(undefined);
const mockBroadcastToProviderTabs = jest.fn().mockResolvedValue(undefined);
const mockInvalidateProviderCommandCaches = jest.fn();
const mockRefreshModelSelector = jest.fn();
const mockCliResolverReset = jest.fn();
const mockRuntimeEnsureReady = jest.fn().mockResolvedValue(false);
const mockRuntimeCleanup = jest.fn();
const mockProbeCli = jest.fn();

jest.mock('fs');
jest.mock('obsidian', () => {
  class MockSetting {
    public name = '';
    public desc = '';
    public heading = false;
    public buttonComponents: MockButtonComponent[] = [];
    public dropdownComponents: MockDropdownComponent[] = [];
    public textComponents: MockTextComponent[] = [];
    public toggleComponents: MockToggleComponent[] = [];

    constructor(_container: unknown) {
      createdSettings.push(this);
    }

    setName(name: string) {
      this.name = name;
      return this;
    }

    setDesc(desc: string) {
      this.desc = desc;
      return this;
    }

    setHeading() {
      this.heading = true;
      return this;
    }

    addText(callback: (text: MockTextComponent) => void) {
      const component = createTextComponent();
      this.textComponents.push(component);
      callback(component);
      return this;
    }

    addToggle(callback: (toggle: MockToggleComponent) => void) {
      const component = createToggleComponent();
      this.toggleComponents.push(component);
      callback(component);
      return this;
    }

    addDropdown(callback: (dropdown: MockDropdownComponent) => void) {
      const component = createDropdownComponent();
      this.dropdownComponents.push(component);
      callback(component);
      return this;
    }

    addButton(callback: (button: MockButtonComponent) => void) {
      const component = createButtonComponent();
      this.buttonComponents.push(component);
      callback(component);
      return this;
    }
  }

  return { Setting: MockSetting };
});

jest.mock('@/features/settings/ui/EnvironmentSettingsSection', () => ({
  renderEnvironmentSettingsSection: (...args: unknown[]) => mockRenderEnvironmentSettingsSection(...args),
}));

jest.mock('@/core/diagnostics/providerHealthCheck', () => ({
  firstOutputLine: (value: string) => value.split('\n')[0] ?? '',
  probeCli: (...args: unknown[]) => mockProbeCli(...args),
}));

jest.mock('@/providers/hermes/app/HermesWorkspaceServices', () => ({
  maybeGetHermesWorkspaceServices: jest.fn(() => ({
    cliResolver: { reset: mockCliResolverReset },
  })),
}));

jest.mock('@/providers/hermes/runtime/HermesChatRuntime', () => ({
  HermesChatRuntime: class MockHermesChatRuntime {
    constructor(readonly plugin: unknown) {}

    ensureReady(...args: unknown[]) {
      return mockRuntimeEnsureReady(...args);
    }

    cleanup() {
      return mockRuntimeCleanup();
    }
  },
}));

jest.mock('@/utils/env', () => ({
  ...jest.requireActual('@/utils/env'),
  getHostnameKey: () => mockGetHostnameKey(),
}));

interface MockTextComponent {
  value: string;
  placeholder: string;
  onChangeCallback: ((value: string) => Promise<void> | void) | null;
  setPlaceholder: (value: string) => MockTextComponent;
  setValue: (value: string) => MockTextComponent;
  onChange: (callback: (value: string) => Promise<void> | void) => MockTextComponent;
  inputEl: { addClass: jest.Mock; toggleClass: jest.Mock; value: string };
}

interface MockToggleComponent {
  value: boolean;
  onChangeCallback: ((value: boolean) => Promise<void> | void) | null;
  setValue: (value: boolean) => MockToggleComponent;
  onChange: (callback: (value: boolean) => Promise<void> | void) => MockToggleComponent;
}

interface MockDropdownComponent {
  options: Array<{ label: string; value: string }>;
  value: string;
  onChangeCallback: ((value: string) => Promise<void> | void) | null;
  addOption: (value: string, label: string) => MockDropdownComponent;
  setValue: (value: string) => MockDropdownComponent;
  onChange: (callback: (value: string) => Promise<void> | void) => MockDropdownComponent;
}

interface MockButtonComponent {
  disabled: boolean;
  text: string;
  onClickCallback: (() => Promise<void> | void) | null;
  setButtonText: (value: string) => MockButtonComponent;
  setDisabled: (value: boolean) => MockButtonComponent;
  onClick: (callback: () => Promise<void> | void) => MockButtonComponent;
}

type MockSettingRecord = {
  buttonComponents: MockButtonComponent[];
  desc: string;
  dropdownComponents: MockDropdownComponent[];
  heading: boolean;
  name: string;
  textComponents: MockTextComponent[];
  toggleComponents: MockToggleComponent[];
};

const createdSettings: MockSettingRecord[] = [];
const createdDomElements: any[] = [];

function createTextComponent(): MockTextComponent {
  const component = {} as MockTextComponent;
  component.value = '';
  component.placeholder = '';
  component.onChangeCallback = null;
  component.inputEl = { addClass: jest.fn(), toggleClass: jest.fn(), value: '' };
  component.setPlaceholder = (value) => {
    component.placeholder = value;
    return component;
  };
  component.setValue = (value) => {
    component.value = value;
    return component;
  };
  component.onChange = (callback) => {
    component.onChangeCallback = callback;
    return component;
  };
  return component;
}

function createToggleComponent(): MockToggleComponent {
  const component = {} as MockToggleComponent;
  component.value = false;
  component.onChangeCallback = null;
  component.setValue = (value) => {
    component.value = value;
    return component;
  };
  component.onChange = (callback) => {
    component.onChangeCallback = callback;
    return component;
  };
  return component;
}

function createDropdownComponent(): MockDropdownComponent {
  const component = {} as MockDropdownComponent;
  component.options = [];
  component.value = '';
  component.onChangeCallback = null;
  component.addOption = (value, label) => {
    component.options.push({ label, value });
    return component;
  };
  component.setValue = (value) => {
    component.value = value;
    return component;
  };
  component.onChange = (callback) => {
    component.onChangeCallback = callback;
    return component;
  };
  return component;
}

function createButtonComponent(): MockButtonComponent {
  const component = {} as MockButtonComponent;
  component.disabled = false;
  component.text = '';
  component.onClickCallback = null;
  component.setButtonText = (value) => {
    component.text = value;
    return component;
  };
  component.setDisabled = (value) => {
    component.disabled = value;
    return component;
  };
  component.onClick = (callback) => {
    component.onClickCallback = callback;
    return component;
  };
  return component;
}

function createElement(tag = 'div', cls?: string): any {
  const classes = new Set<string>();
  const eventListeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const element: any = {
    checked: false,
    cls,
    open: false,
    placeholder: '',
    style: {},
    tag,
    text: '',
    title: '',
    value: '',
    classList: {
      add: jest.fn((name: string) => classes.add(name)),
      contains: jest.fn((name: string) => classes.has(name)),
      remove: jest.fn((name: string) => classes.delete(name)),
      toggle: jest.fn((name: string, force?: boolean) => {
        if (force) classes.add(name);
        else classes.delete(name);
        return Boolean(force);
      }),
    },
    addClass: jest.fn((name: string) => classes.add(name)),
    addEventListener: jest.fn((type: string, callback: (...args: unknown[]) => void) => {
      const listeners = eventListeners.get(type) ?? [];
      listeners.push(callback);
      eventListeners.set(type, listeners);
    }),
    appendText: jest.fn(),
    blur: jest.fn(),
    dispatchMockEvent: async (type: string, event?: unknown) => {
      for (const listener of eventListeners.get(type) ?? []) {
        await listener(event);
      }
    },
    empty: jest.fn(),
    hasClass: jest.fn((name: string) => classes.has(name)),
    removeClass: jest.fn((name: string) => classes.delete(name)),
    setAttribute: jest.fn(),
    setText: jest.fn((value: string) => {
      element.text = value;
    }),
    toggleClass: jest.fn((name: string, force: boolean) => {
      if (force) classes.add(name);
      else classes.delete(name);
    }),
  };

  const makeChild = (childTag: string, attrs?: Record<string, unknown>): any => {
    const child = createElement(childTag, typeof attrs?.cls === 'string' ? attrs.cls : undefined);
    if (typeof attrs?.text === 'string') child.text = attrs.text;
    if (typeof attrs?.type === 'string') child.type = attrs.type;
    if (typeof attrs?.value === 'string') child.value = attrs.value;
    createdDomElements.push(child);
    return child;
  };

  element.createDiv = jest.fn((attrs?: Record<string, unknown>) => makeChild('div', attrs));
  element.createEl = jest.fn((childTag?: string, attrs?: Record<string, unknown>) =>
    makeChild(childTag ?? 'div', attrs));
  element.createSpan = jest.fn((attrs?: Record<string, unknown>) => makeChild('span', attrs));
  return element;
}

function createPlugin(config: Record<string, unknown> = {}): any {
  const view = {
    getTabManager: jest.fn(() => ({ broadcastToProviderTabs: mockBroadcastToProviderTabs })),
    invalidateProviderCommandCaches: mockInvalidateProviderCommandCaches,
    refreshModelSelector: mockRefreshModelSelector,
  };

  return {
    getAllViews: jest.fn(() => [view]),
    getResolvedProviderCliPath: jest.fn(() => '/usr/local/bin/hermes'),
    saveSettings: mockSaveSettings,
    settings: { providerConfigs: { hermes: { enabled: true, ...config } } },
  };
}

function createContext(plugin: any) {
  return {
    plugin,
    refreshModelSelectors: jest.fn(),
    renderCustomContextLimits: jest.fn(),
    renderHiddenProviderCommandSetting: jest.fn(),
  };
}

function findSetting(name: string): MockSettingRecord {
  const setting = createdSettings.find((candidate) => candidate.name === name);
  if (!setting) {
    throw new Error(`Setting not found: ${name}`);
  }
  return setting;
}

describe('HermesSettingsTab', () => {
  const mockedExistsSync = fs.existsSync as jest.MockedFunction<typeof fs.existsSync>;
  const mockedStatSync = fs.statSync as jest.MockedFunction<typeof fs.statSync>;

  beforeEach(() => {
    createdSettings.length = 0;
    createdDomElements.length = 0;
    jest.clearAllMocks();
    mockGetHostnameKey.mockReturnValue('host-a');
    mockRuntimeEnsureReady.mockResolvedValue(false);
    mockProbeCli.mockResolvedValue({ ok: true, output: 'Hermes Agent v0.20.5' });
    mockedExistsSync.mockReturnValue(true);
    mockedStatSync.mockReturnValue({ isFile: () => true } as never);
  });

  it('renders every configuration section', () => {
    hermesSettingsTabRenderer.render(createElement(), createContext(createPlugin()));

    const headings = createdSettings.filter((setting) => setting.heading).map((setting) => setting.name);
    expect(headings).toEqual(['Einrichtung', 'Modelle', 'Verhalten', 'Befehle und Skills']);
    expect(mockRenderEnvironmentSettingsSection).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'provider:hermes' }),
    );
  });

  it('persists the enable toggle', async () => {
    const plugin = createPlugin({ enabled: false });
    hermesSettingsTabRenderer.render(createElement(), createContext(plugin));

    await findSetting('Hermes aktivieren').toggleComponents[0].onChangeCallback?.(true);

    expect(getHermesProviderSettings(plugin.settings).enabled).toBe(true);
    expect(mockSaveSettings).toHaveBeenCalled();
  });

  it('recycles the runtime after a behaviour toggle that needs a restart', async () => {
    const plugin = createPlugin();
    hermesSettingsTabRenderer.render(createElement(), createContext(plugin));

    await findSetting('Gefährliche Befehle ohne Rückfrage (YOLO)').toggleComponents[0]
      .onChangeCallback?.(true);

    expect(getHermesProviderSettings(plugin.settings).yoloMode).toBe(true);
    expect(mockBroadcastToProviderTabs).toHaveBeenCalledWith('hermes', expect.any(Function));
    expect(mockInvalidateProviderCommandCaches).toHaveBeenCalledWith(['hermes']);
  });

  it('does not restart the runtime for the vault-prompt toggle', async () => {
    const plugin = createPlugin();
    hermesSettingsTabRenderer.render(createElement(), createContext(plugin));

    await findSetting('Vault-Systemprompt senden').toggleComponents[0].onChangeCallback?.(false);

    expect(getHermesProviderSettings(plugin.settings).injectVaultPrompt).toBe(false);
    expect(mockBroadcastToProviderTabs).not.toHaveBeenCalled();
  });

  it('offers the discovered modes in the approval dropdown', () => {
    const plugin = createPlugin({ selectedMode: 'accept_edits' });
    updateHermesDiscoveryState(plugin.settings, {
      availableModes: [
        { id: 'default', name: 'Default' },
        { id: 'accept_edits', name: 'Accept Edits' },
        { id: 'dont_ask', name: "Don't Ask" },
      ],
    });
    hermesSettingsTabRenderer.render(createElement(), createContext(plugin));

    const dropdown = findSetting('Freigabe-Modus').dropdownComponents[0];
    expect(dropdown.options.map((option) => option.value)).toEqual([
      'default',
      'accept_edits',
      'dont_ask',
    ]);
    expect(dropdown.value).toBe('accept_edits');
  });

  it('rejects a CLI path that is not a file and keeps the old setting', async () => {
    mockedStatSync.mockReturnValue({ isFile: () => false } as never);
    const plugin = createPlugin();
    hermesSettingsTabRenderer.render(createElement(), createContext(plugin));

    await findSetting('CLI-Pfad').textComponents[0].onChangeCallback?.('/opt/hermes');

    expect(getHermesProviderSettings(plugin.settings).cliPathsByHost).toEqual({});
    expect(mockSaveSettings).not.toHaveBeenCalled();
  });

  it('stores a valid CLI path for this host and resets the resolver', async () => {
    const plugin = createPlugin();
    hermesSettingsTabRenderer.render(createElement(), createContext(plugin));

    await findSetting('CLI-Pfad').textComponents[0].onChangeCallback?.(' /opt/hermes/bin/hermes ');

    expect(getHermesProviderSettings(plugin.settings).cliPathsByHost).toEqual({
      'host-a': '/opt/hermes/bin/hermes',
    });
    expect(mockCliResolverReset).toHaveBeenCalled();
  });

  it('reports a healthy runtime after both probes succeed', async () => {
    hermesSettingsTabRenderer.render(createElement(), createContext(createPlugin()));

    await findSetting('Hermes-Runtime prüfen').buttonComponents[0].onClickCallback?.();

    expect(mockProbeCli).toHaveBeenCalledTimes(2);
    expect(mockProbeCli).toHaveBeenLastCalledWith(expect.objectContaining({
      args: ['acp', '--check'],
    }));
  });

  it('reports a missing ACP dependency instead of claiming readiness', async () => {
    mockProbeCli
      .mockResolvedValueOnce({ ok: true, output: 'Hermes Agent v0.20.5' })
      .mockResolvedValueOnce({ detail: 'exited', ok: false, output: 'ModuleNotFoundError: acp' });
    hermesSettingsTabRenderer.render(createElement(), createContext(createPlugin()));

    await findSetting('Hermes-Runtime prüfen').buttonComponents[0].onClickCallback?.();

    const status = createdDomElements.find((element) => element.text?.includes('ACP nicht bereit'));
    expect(status).toBeDefined();
  });

  it('loads the catalog through a throwaway runtime when the browser is opened', async () => {
    hermesSettingsTabRenderer.render(createElement(), createContext(createPlugin()));

    // An empty visible list opens the catalog immediately.
    expect(mockRuntimeEnsureReady).toHaveBeenCalledWith({ allowSessionCreation: true });
    await Promise.resolve();
    expect(mockRuntimeCleanup).toHaveBeenCalled();
  });
});
