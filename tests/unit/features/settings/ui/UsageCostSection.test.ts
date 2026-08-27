import { createMockEl } from '@test/helpers/mockElement';

import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import { renderUsageCostSection } from '@/features/settings/ui/UsageCostSection';

function withStyleApi(element: ReturnType<typeof createMockEl>): ReturnType<typeof createMockEl> {
  element.style.setProperty = (name: string, value: string) => {
    element.style[name] = value;
  };
  const createDiv = element.createDiv.bind(element);
  element.createDiv = (options?: { cls?: string; text?: string }) => withStyleApi(createDiv(options));
  const createSpan = element.createSpan.bind(element);
  element.createSpan = (options?: { cls?: string; text?: string }) => withStyleApi(createSpan(options));
  return element;
}

describe('renderUsageCostSection active document compatibility', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    Reflect.deleteProperty(globalThis, 'activeDocument');
  });

  it('creates detached window and budget cards through activeDocument', () => {
    const createElement = jest.fn((tagName: string) => withStyleApi(createMockEl(tagName)));
    Object.defineProperty(globalThis, 'activeDocument', {
      configurable: true,
      value: { createElement },
    });
    jest.spyOn(ProviderRegistry, 'getRegisteredProviderIds').mockReturnValue([]);

    const now = Date.now();
    const plugin = {
      persistTokenUsage: jest.fn(),
      saveSettings: jest.fn(),
      settings: {
        dailyTokenBudget: 1000,
        tokenBudgetEnabled: true,
      },
      tokenBudgetTracker: {
        getDailySeries: jest.fn().mockReturnValue([]),
        getEvents: jest.fn().mockReturnValue([]),
        getSeenProviderIds: jest.fn().mockReturnValue([]),
        getWindowedProviders: jest.fn().mockReturnValue([{
          oldestEventAt: now - 1000,
          providerId: 'claude',
          resetAt: now + 1000,
          runs: 1,
          todayTokens: 100,
          tokens: 100,
          windowHours: 5,
        }]),
        resetDaily: jest.fn(),
        resetSession: jest.fn(),
      },
    } as any;

    renderUsageCostSection(createMockEl() as HTMLElement, plugin);

    expect(createElement).toHaveBeenCalledTimes(2);
    expect(createElement).toHaveBeenNthCalledWith(1, 'div');
    expect(createElement).toHaveBeenNthCalledWith(2, 'div');
  });
});
