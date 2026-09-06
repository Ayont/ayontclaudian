import { createMockEl } from '@test/helpers/mockElement';
import type { App } from 'obsidian';

import { DEFAULT_CLAUDIAN_SETTINGS } from '@/app/settings/defaultSettings';
import { ClaudianSettingTab } from '@/features/settings/ClaudianSettings';
import type ClaudianPlugin from '@/main';
import { registerBuiltInProviders } from '@/providers';

describe('ClaudianSettingTab', () => {
  let mockApp: any;
  let mockPlugin: any;
  let tab: ClaudianSettingTab;

  beforeAll(() => {
    registerBuiltInProviders();
  });

  beforeEach(() => {
    mockApp = {
      vault: {
        adapter: {
          basePath: '/test/vault',
          exists: jest.fn().mockResolvedValue(false),
          read: jest.fn().mockResolvedValue(''),
          write: jest.fn().mockResolvedValue(undefined),
        },
      },
      workspace: {
        getLeavesOfType: jest.fn().mockReturnValue([]),
      },
    };

    mockPlugin = {
      app: mockApp,
      manifest: {
        id: 'realclaudian',
        name: 'Claudian',
        version: '1.0.0',
      },
      settings: JSON.parse(JSON.stringify(DEFAULT_CLAUDIAN_SETTINGS)),
      saveSettings: jest.fn().mockResolvedValue(undefined),
      getAllViews: jest.fn().mockReturnValue([]),
      getView: jest.fn().mockReturnValue(null),
      getPendingPluginUpdate: jest.fn().mockReturnValue(null),
      checkAndOfferPluginUpdate: jest.fn().mockResolvedValue(null),
      getActiveEnvironmentVariables: jest.fn().mockReturnValue(''),
      tokenBudgetTracker: {
        getSeenProviderIds: jest.fn().mockReturnValue([]),
        getEvents: jest.fn().mockReturnValue([]),
        getWindowedProviders: jest.fn().mockReturnValue([]),
        getDailySeries: jest.fn().mockReturnValue([]),
        getProviderWindow: jest.fn().mockReturnValue(null),
        resetSession: jest.fn(),
        resetDaily: jest.fn(),
      },
    };

    tab = new ClaudianSettingTab(mockApp as App, mockPlugin as unknown as ClaudianPlugin);
    tab.containerEl = createMockEl('div');
  });

  it('renders display without error and constructs all category panes', () => {
    expect(() => tab.display()).not.toThrow();

    const panes = tab.containerEl.querySelectorAll('.claudian-settings-category-pane');
    expect(panes.length).toBe(6);
  });

  it('renders provider hub and all registered providers safely', () => {
    tab.activeTab = 'providers';
    expect(() => tab.display()).not.toThrow();

    const hub = tab.containerEl.querySelector('.claudian-provider-hub');
    expect(hub).toBeTruthy();

    const pills = tab.containerEl.querySelectorAll('.claudian-provider-pill');
    expect(pills.length).toBeGreaterThanOrEqual(13);

    const panes = tab.containerEl.querySelectorAll('.claudian-provider-pane');
    expect(panes.length).toBeGreaterThanOrEqual(13);
  });

  it('switches between all categories without throwing and renders their content', () => {
    const categories = ['general', 'providers', 'intelligence', 'tools', 'input', 'budget'] as const;
    for (const cat of categories) {
      tab.activeTab = cat;
      expect(() => tab.display()).not.toThrow();
    }
  });
});
